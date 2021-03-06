// ==UserScript==
// @name         Github comment badges
// @namespace    https://github.com/matthizou
// @version      1.2.1
// @description  Add badges to comment icons in PR list. Periodically and transparently refreshes those badges
// @author       Matt
// @match        https://github.com/*
// @match        https://source.xing.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest

// ==/UserScript==

;(async function() {
    'use strict'
    console.log('Starting extension: Github comment Badges')

    // Change this value to poll more often
    const REFRESH_INTERVAL_PERIOD = 90000
    const REFRESH_INTERVAL_PERIOD_FOR_DETAILS_PAGE = 60000

    // -------------------
    // MAIN LOGIC FUNCTIONS
    // -------------------

    /** Fetch counts info from the server and update the list page */
    function fetchCountDataForTheListPage() {
        const url = window.location.href
        GM.xmlHttpRequest({
            method: 'GET',
            url,
            onload: response => {
                const newCountData = parseListPageHTML(response.responseText)
                processListPage(newCountData)
            },
        })
    }

    /** Fetch counts info from the server and update the list page */
    function fetchCountDataForTheDetailsPage() {
        const { repoOwner, repo, section, itemId } = getInfoFromUrl()
        const url = `/${repoOwner}/${repo}/${section}/${itemId}/commits`
        GM.xmlHttpRequest({
            method: 'GET',
            url,
            onload: response => {
                const newCountData = parseDetailsPageHTML(response.responseText)
                processDetailsPage(newCountData)
            },
        })
    }

    /**
     * Extract the count data from the HTML string representation of the page
     * Notes: We may, in the future use the Github Rest/GraphQL Api to get those counts.
     * It comes with its own overheads (such as providing an authentication token, instable API, etc.),
     * and I find that for non-intensive queries such as here, scraping the HTML is more versatile and robust.
     * */
    function parseListPageHTML(pageHtml) {
        let rowsInfo = [],
            startSearchIndex,
            rowHtml,
            rowInfo,
            comment,
            htmlLength,
            results = {}

        const rowRegex = /id="issue_([0-9]+)/g
        const commentRegex = /aria-label="([0-9]+) comment[s]?"/

        // Find start of PR rows
        let match = rowRegex.exec(pageHtml)
        while (match !== null) {
            rowsInfo.push({ id: match[1], index: match.index })
            match = rowRegex.exec(pageHtml)
        }

        // Get count
        for (let i = 0; i < rowsInfo.length; i++) {
            rowInfo = rowsInfo[i]
            startSearchIndex = rowInfo.index
            htmlLength =
                i === rowsInfo.length - 1 ? undefined : rowsInfo[i + 1].index - startSearchIndex
            rowHtml = pageHtml.substr(startSearchIndex, htmlLength)
            comment = commentRegex.exec(rowHtml)
            results[rowInfo.id] = comment ? parseInt(comment[1], 10) : 0
        }

        return results
    }

    function parseDetailsPageHTML(pageHtml) {
        try {
            const regex = /id="conversation_tab_counter[^<]*/
            const match = regex.exec(pageHtml)
            const strCount = match[0].replace(/\s/g, '').replace(/.*>/, '')
            return parseInt(parseInt(strCount, 10))
        } catch (ex) {
            return null
        }
    }

    /**
     * Processing function for the list pages.
     * Compare displayed count data to stored count data, adding badges and extra styling to the comments container of each row.
     * @params {Object} fetchedData - Optional. Fresh data from the server.
     */
    async function processListPage(fetchedData) {
        const repoData = await getRepoData()
        const dataToUpdate = {}

        $('.repository-content [data-id]').forEach(row => {
            const pullRequestId = row.id.replace('issue_', '')
            const icon = row.querySelector('.octicon-comment')

            let container, displayedMessageCount
            if (icon) {
                container = icon.parentNode
                displayedMessageCount = parseInt(container.innerText, 10) // todo : WEAK. Use aria-label instead
            } else {
                container = row.querySelector('.float-right .float-right')
                displayedMessageCount = 0
            }

            const countFromServer =
                fetchedData && fetchedData[pullRequestId] >= 0
                    ? fetchedData[pullRequestId]
                    : undefined
            const messageCount =
                countFromServer !== undefined ? countFromServer : displayedMessageCount

            if (displayedMessageCount !== messageCount) {
                // The displayed count is outdated, update it
                if (messageCount === 0) {
                    // The count has decreased to 0, remove icon
                    container.innerHTML = ''
                } else if (displayedMessageCount === 0) {
                    // We need to add the icon
                    container.innerHTML = `
<a href="#" class="muted-link" aria-label="${messageCount} comments" style="position: relative;">
<svg class="octicon octicon-comment v-align-middle" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M14 1H2c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h2v3.5L7.5 11H14c.55 0 1-.45 1-1V2c0-.55-.45-1-1-1zm0 9H7l-2 2v-2H2V2h12v8z"></path></svg><i data-id="unread-notification" style="position: absolute; z-index: 2; border-radius: 50%; color: rgb(255, 255, 255); width: 8px; height: 8px; top: 0px; left: 9px; border-width: 0px; background-image: linear-gradient(rgb(187, 187, 187), rgb(204, 204, 204));"></i>
<span class="text-small text-bold">${messageCount}</span>
</a>
`
                } else {
                    // The icon exists - simply update text
                    container.querySelector('span').innerText = messageCount // todo: look for a more robust way
                }
            }

            const storedMessageCount = repoData[pullRequestId]

            if (storedMessageCount && messageCount < displayedMessageCount) {
                // The count decreased
                // Stored data needs to be updated in certain cases, otherwise an new incoming comment may not be notified
                dataToUpdate[pullRequestId] = messageCount
            }

            if (storedMessageCount === undefined) {
                // The user has never looked at this PR
                if (container) {
                    toggleUnreadStyle(container, true)
                    toggleMessageNotificationIcon({
                        container,
                        isMuted: true,
                    })
                }
            } else {
                toggleUnreadStyle(container, false)
                if (messageCount > storedMessageCount) {
                    // This PR has new messages
                    toggleMessageNotificationIcon({
                        show: true,
                        container,
                        highlight: messageCount - storedMessageCount >= 5,
                    })
                } else if (messageCount > 0) {
                    // This PR has no new messages
                    toggleMessageNotificationIcon({
                        container,
                        show: false,
                    })
                }
            }
        })

        if (Object.keys(dataToUpdate).length) {
            setRepoData({ ...repoData, ...dataToUpdate })
        }
    }

    /**
     * Processing function for the detail pages.
     * Looks for the count number and stores it
     */
    async function processDetailsPage(counter) {
        const repoData = await getRepoData()
        const { section, itemId } = getInfoFromUrl()
        let text
        let messageCount = counter

        if (messageCount === undefined || messageCount === null) {
            // Get message count from the UI
            if (section === 'pull') {
                text = document.getElementById('conversation_tab_counter').innerText
                messageCount = parseInt(text, 10)
            } else if (section === 'issues') {
                // ie: "matthizou opened this issue on 23 Nov 2018 · 2 comments"
                text = $('a.author')
                    .map(x => x.parentNode.innerText)
                    .find(text => text.indexOf('comment') > 0)
                text = /([0-9]+) comment/.exec(text)[1]
                messageCount = parseInt(text, 10)
            }
        }

        // console.log(`processDetailsPage ${messageCount}`)

        // Compare current number of messages in the PR to the one stored from the last visit
        // Update it if they don't match
        if (Number.isInteger(messageCount)) {
            const previousMessageCount = repoData[itemId]
            if (messageCount !== previousMessageCount) {
                setRepoData({ ...repoData, [itemId]: messageCount })
                if (section === 'pull') {
                    document.getElementById('conversation_tab_counter').innerText = messageCount
                }
                // todo: update text for issues
            }
        }
    }

    const selectorEnum = {
        LIST: '#js-issues-toolbar',
        DETAILS: ['#discussion_bucket', '#files_bucket', '#commits_bucket'],
    }

    let refreshIntervalId
    let refreshIntervalIdForPageDetails

    async function applyExtension() {
        // Element that signals that we are on such or such page
        let landmarkElement

        document.removeEventListener('keypress', onKeyPressedInDetailsPage)

        if (isListPage()) {
            // LIST PAGE
            landmarkElement = await waitForUnmarkedElement(selectorEnum.LIST)
            markElement(landmarkElement)
            processListPage()
            if (!refreshIntervalId) {
                refreshIntervalId = setInterval(
                    fetchCountDataForTheListPage,
                    REFRESH_INTERVAL_PERIOD
                )
            }
            clearPollers('details')
        } else if (isDetailsPage()) {
            // DETAILS PAGE
            landmarkElement = await waitForUnmarkedElement(selectorEnum.DETAILS, {
                priority: 'low',
            })
            markElement(landmarkElement)

            processDetailsPage()
            setPollerForDetailsPage()
            document.addEventListener('keypress', onKeyPressedInDetailsPage)
            clearPollers('list')
        } else {
            clearPollers()
        }
    }

    function onKeyPressedInDetailsPage() {
        document.removeEventListener('keypress', onKeyPressedInDetailsPage)
        // Reset the poller/interval to use faster polling
        clearPollers('details')
        setPollerForDetailsPage(REFRESH_INTERVAL_PERIOD_FOR_DETAILS_PAGE)
    }

    /**  */
    function setPollerForDetailsPage(intervalTime = REFRESH_INTERVAL_PERIOD) {
        if (!refreshIntervalIdForPageDetails && getInfoFromUrl().section === 'pull') {
            // todo: logic for the issue page
            refreshIntervalIdForPageDetails = setInterval(
                fetchCountDataForTheDetailsPage,
                intervalTime
            )
        }
    }

    function clearPollers(type) {
        if (!type || type === 'details') {
            clearInterval(refreshIntervalIdForPageDetails)
            refreshIntervalIdForPageDetails = null
        }
        if (!type || type === 'list') {
            clearInterval(refreshIntervalId)
            refreshIntervalId = null
        }
    }

    function toggleUnreadStyle(container, isUnread) {
        const unreadColor = '#c6cad0'
        if (isUnread) {
            container.style.setProperty('color', unreadColor, 'important')
        } else {
            container.style.removeProperty('color')
        }
    }

    function toggleMessageNotificationIcon({ container, highlight, isMuted = false, show = true }) {
        const icon = container && container.querySelector('svg')
        if (!icon) {
            return
        }
        let notification = container.querySelector('[data-id="unread-notification"]')

        if (show) {
            if (!notification) {
                container.style.position = 'relative'
                // Create element for notification
                notification = document.createElement('i')
                notification.dataset.id = 'unread-notification'
                notification.className = 'gcm-comment-badge'
                // Add it to the DOM
                insertAfter(notification, icon)
            }
            if (isMuted) {
                notification.className += ' gcm-comment-badge-muted'
            } else {
                notification.className += highlight
                    ? ' gcm-comment-badge-many-comments'
                    : ' gcm-comment-badge-some-comments'
            }
        } else {
            // Don't show notification
            if (notification) {
                // Remove existing element
                container.removeChild(notification)
            }
        }
    }

    /** Check page url and returns whether or not we are in a list page (pull request/issues lists )*/
    function isListPage() {
        const { section, itemId } = getInfoFromUrl()
        return section === 'pulls' || (section === 'issues' && !itemId)
    }

    function isDetailsPage() {
        const { section, itemId } = getInfoFromUrl()
        return section === 'pull' || (section === 'issues' && itemId)
    }

    async function getRepoData() {
        const key = getDataKey()
        return await getStoreData(key)
    }

    async function setRepoData(data) {
        const key = getDataKey()
        return await GM.setValue(key, data)
    }

    function getDataKey() {
        const { repoOwner, repo } = getInfoFromUrl()
        return `${repoOwner}/${repo}`
    }

    const PROCESSED_FLAG = 'comment_badges_extension_flag'

    function markElement(element) {
        element.dataset[PROCESSED_FLAG] = true
    }

    function isMarked(element) {
        return element.dataset && element.dataset[PROCESSED_FLAG]
    }

    async function waitForUnmarkedElement(selector, options = {}) {
        return await waitFor(selector, {
            ...options,
            condition: element => !isMarked(element),
        })
    }

    // -------------------
    // STARTUP BLOCK
    // -------------------
    addStyle(`
.gcm-comment-badge { position: absolute; z-index: 2; border-radius: 50px; color: #fff; width: 8px; height: 8px; top: 0; left: 9px; border-width: 0 }
.gcm-comment-badge-muted{ background-image: linear-gradient(#CCC,#CCC)}
.gcm-comment-badge-some-comments{background-image: linear-gradient(#54a3ff,#006eed)}
.gcm-comment-badge-many-comments{ background-image: linear-gradient(#d73a49, #cb2431)}
`)

    // Process page
    applyExtension()

    // Ensure we rerun the page transform code when the route changes
    const pushState = history.pushState
    history.pushState = function() {
        pushState.apply(history, arguments)
        applyExtension()
    }

    // Handle browser navigation changes (previous/forward button)
    window.onpopstate = function(event) {
        if (isListPage()) {
            fetchCountDataForTheListPage()
            clearInterval(refreshIntervalIdForPageDetails)
            refreshIntervalIdForPageDetails = null
            if (!refreshIntervalId) {
                refreshIntervalId = setInterval(
                    fetchCountDataForTheListPage,
                    REFRESH_INTERVAL_PERIOD
                )
            }
        }
    }

    // ---------------
    // UTIL FUNCTIONS
    // ---------------

    function getInfoFromUrl() {
        const [repoOwner, repo, section, itemId] = window.location.pathname.substr(1).split('/')
        return {
            repoOwner,
            repo,
            section,
            itemId,
        }
    }

    /** Get data from data store */
    async function getStoreData(namespace) {
        const data = await GM.getValue(namespace)
        return data || {}
    }

    /** Shorthand for querySelectorAll, JQuery style */
    function $(selector, element = document) {
        return Array.from(element.querySelectorAll(selector))
    }

    /** Insert in DOM the specified node right after the specified reference node */
    function insertAfter(newNode, referenceNode) {
        referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling)
    }

    /** Insert css styles in a stylesheet injected in the head of the document */
    function addStyle(css) {
        const style = document.createElement('style')
        style.type = 'text/css'
        style.innerHTML = css
        document.getElementsByTagName('head')[0].appendChild(style)
    }

    /**
     * Wait for an element to appear in document. When not found, wait a bit, and tries again,
     * until the maximum waiting time is reached.
     * @return {Promise}
     */
    function waitFor(selector, options = {}) {
        const { priority = 'medium', condition, maxTime = 20000 } = options
        let intervalPeriod

        switch (priority) {
            case 'low':
                intervalPeriod = 500
                break
            case 'high':
                intervalPeriod = 50
                break
            default:
                intervalPeriod = 200
                break
        }
        const maxRetries = Math.floor(maxTime / intervalPeriod)

        let iterationCount = 0

        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                let element

                if (Array.isArray(selector)) {
                    element = selector.map(s => document.querySelector(s)).find(el => !!el)
                } else {
                    element = document.querySelector(selector)
                }
                if (element && (!condition || condition(element))) {
                    clearInterval(interval)
                    resolve(element)
                } else if (++iterationCount > maxRetries) {
                    // End of cycle with failure
                    clearInterval(interval)
                    reject(`Github PR extension error: timeout, couldn't find element ${selector}`)
                }
            }, intervalPeriod)
        })
    }
})()
