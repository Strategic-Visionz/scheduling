const CacheUtility = {
    // Cache configuration defaults
    DEFAULT_DURATION: 3600000, // 1 hour in milliseconds
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000, // 1 second

    /**
     * Get valid cached data for a given key
     * @param {string} key - Cache key
     * @param {number} duration - Cache duration in milliseconds
     * @param {Function} validator - Function to validate cached data
     * @returns {Object|null} The cached data or null if invalid/missing
     */
    getValidCache: function (key, duration, validator) {
        try {
            const cached = localStorage.getItem(key);
            if (!cached) return null;

            const { data, timestamp } = JSON.parse(cached);
            const isExpired = Date.now() - timestamp > duration;

            // Use provided validator or default to true
            const isValidData = validator ? validator(data) : true;

            return (!isExpired && isValidData) ? data : null;
        } catch (error) {
            console.warn(`Cache validation failed for ${key}:`, error);
            localStorage.removeItem(key);
            return null;
        }
    },

    /**
     * Update cache with new data
     * @param {string} key - Cache key
     * @param {any} data - Data to cache
     */
    updateCache: function (key, data) {
        try {
            const cacheData = {
                data,
                timestamp: Date.now()
            };
            localStorage.setItem(key, JSON.stringify(cacheData));
        } catch (error) {
            console.warn(`Failed to update cache for ${key}:`, error);
            if (error.name === 'QuotaExceededError') {
                localStorage.clear();
                try {
                    localStorage.setItem(key, JSON.stringify(cacheData));
                } catch (retryError) {
                    console.error(`Failed to update cache after clearing for ${key}:`, retryError);
                }
            }
        }
    },

    /**
     * Make API call with retry logic
     * @param {Function} apiCall - Function that makes the API call
     * @param {number} retryCount - Current retry attempt
     * @returns {Promise} Promise resolving to the API response
     */
    makeApiCallWithRetry: async function (apiCall, retryCount = 0) {
        try {
            return await apiCall();
        } catch (error) {
            if (retryCount < this.MAX_RETRIES) {
                console.warn(`API call failed, retrying (${retryCount + 1}/${this.MAX_RETRIES})...`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * (retryCount + 1)));
                return this.makeApiCallWithRetry(apiCall, retryCount + 1);
            }
            throw error;
        }
    },

    /**
     * Fetch data with caching
     * @param {Object} config - Configuration object
     * @returns {Promise} Promise resolving to the data
     */
    fetchWithCache: async function ({
        cacheKey,
        cacheDuration = this.DEFAULT_DURATION,
        validator,
        apiCall,
        processData = (data) => data,
        useExpiredCache = true
    }) {
        try {
            // Check for valid cached data first
            const cachedData = this.getValidCache(cacheKey, cacheDuration, validator);
            if (cachedData) {
                console.log(`Using cached data for ${cacheKey}`);
                return processData(cachedData);
            }

            // If no valid cache, make API call
            const data = await this.makeApiCallWithRetry(apiCall);
            const processedData = processData(data);
            this.updateCache(cacheKey, processedData);
            console.log(`Fetched fresh data for ${cacheKey}`);
            return processedData;

        } catch (error) {
            console.error(`Failed to fetch data for ${cacheKey}:`, error);

            // If API fails and useExpiredCache is true, try to use expired cache as fallback
            if (useExpiredCache) {
                try {
                    const expiredCache = localStorage.getItem(cacheKey);
                    if (expiredCache) {
                        const { data } = JSON.parse(expiredCache);
                        return processData(data);
                    }
                } catch (cacheError) {
                    console.error(`Failed to use expired cache for ${cacheKey}:`, cacheError);
                }
            }

            throw error;
        }
    }
};

window.HunkProScheduler = {
    FullCalendar: null,
    calendar: null,
    shifts: [], // Store shifts data
    availability: [], // Store availability data
    tb_app_id: 'VWQWR8A9NZ',
    tb_app_key: 'GzkHdwxG3lKE',
    tb_app_secret: 'g8qR0yK8Jv8pW8Op8T1vtxJkBFC8d8pp',

    overrideDates: new Map(),

    isRefreshing: false,
    refreshQueue: Promise.resolve(),
    lastRefreshTime: 0,
    REFRESH_COOLDOWN: 800, // minimum ms between refreshes

    // Add these two new variables here
    _lastRequestedStart: null,
    _lastRequestedEnd: null,

    availabilityClassMap: {
        'Regular Day Off': 'hunkpro-unavailable-regular',
        'Vacation': 'hunkpro-unavailable-vacation',
        'Injury - Work Related': 'hunkpro-unavailable-injury',
        'Injury - Outside of Work': 'hunkpro-unavailable-injury',
        'Personal Emergency': 'hunkpro-unavailable-emergency',
        'Suspension': 'hunkpro-unavailable-suspension'
    },

    positionClassMap: {
        'Closer': 'hunkpro-shift-closer',
        'Morning Dispatch': 'hunkpro-shift-morningdispatch',
        'Trainer': 'hunkpro-shift-trainer',
        'Estimator': 'hunkpro-shift-estimator',
        'Captain - Paperwork Only': 'hunkpro-shift-captainpaperworkonly',
        'Captain - Driver Only': 'hunkpro-shift-captaindriveronly',
        'Captain - Full': 'hunkpro-shift-captainfull',
        'Wingman': 'hunkpro-shift-wingman'
    },

    tagsTableData: [],
    tagStatistics: {},
    pendingOperations: new Map(),

    countUnpublishedShifts: function () {
        const currentView = this.calendar.view;
        const viewStart = new Date(`${currentView.activeStart.toISOString().split('T')[0]}T00:00:00Z`);
        const viewEnd = new Date(`${currentView.activeEnd.toISOString().split('T')[0]}T23:59:59.999Z`);
        const adjustedEndDate = new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000);

        const startDateStr = viewStart.toISOString().split('T')[0];
        const endDateStr = adjustedEndDate.toISOString().split('T')[0];

        // Initialize counters
        const counts = {
            notPublished: 0,
            rePublish: 0,
            total: 0
        };

        // Filter shifts within current view
        this.shifts.forEach(shift => {
            const shiftDate = new Date(shift.start);
            if (shiftDate >= viewStart && shiftDate < adjustedEndDate) {
                switch (shift.extendedProps.publishStatus) {
                    case 'Not Published':
                        counts.notPublished++;
                        counts.total++;
                        break;
                    case 'Re-Publish':
                        counts.rePublish++;
                        counts.total++;
                        break;
                }
            }
        });

        return counts;
    },

    updatePublishButton: function (counts) {
        const publishButton = this.calendar.el.querySelector('.fc-publish-button');
        if (publishButton) {
            publishButton.innerHTML = `Publish <span class="publish-count">${counts.total}</span>`;
        }
    },

    showPublishDialog: async function () {
        const modal = document.getElementById('hunkpro-publish-modal');
        const statsLoader = modal.querySelector('.stats-loader');
        const statsContent = modal.querySelector('.stats-content');
        const dateRange = modal.querySelector('#publish-date-range');
        const confirmButton = modal.querySelector('#confirmPublish');

        const currentView = this.calendar.view;
        const viewStart = new Date(`${currentView.activeStart.toISOString().split('T')[0]}T00:00:00Z`);
        const viewEnd = new Date(`${currentView.activeEnd.toISOString().split('T')[0]}T23:59:59.999Z`);
        const adjustedEndDate = new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000);

        const startDateStr = viewStart.toISOString().split('T')[0];
        const endDateStr = adjustedEndDate.toISOString().split('T')[0];

        dateRange.textContent = `${startDateStr} to ${endDateStr}`;

        // Show modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();

        // Show loader, hide content, disable publish button
        statsLoader.classList.remove('chhj-hide');
        statsContent.classList.add('chhj-hide');
        confirmButton.disabled = true;
        confirmButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Please wait...';

        try {
            // Refresh events
            await this.refreshEvents();

            // Get counts using the updated method
            const counts = this.countUnpublishedShifts();

            // Update counts in modal
            modal.querySelector('#publishCount').textContent = counts.notPublished;
            modal.querySelector('#republishCount').textContent = counts.rePublish;
            modal.querySelector('#conflictsCount').textContent = '0'; // Replace with actual conflict detection

            // Show content, hide loader, enable and restore publish button
            statsLoader.classList.add('chhj-hide');
            statsContent.classList.remove('chhj-hide');
            confirmButton.disabled = false;
            confirmButton.textContent = 'Publish Shifts';

        } catch (error) {
            console.error('Error refreshing events:', error);
            // Handle error - show error message in modal
            statsLoader.classList.add('chhj-hide');
            statsContent.classList.remove('chhj-hide');
            confirmButton.disabled = false;
            confirmButton.textContent = 'Publish Shifts';

            await Swal.fire({
                title: 'Error',
                text: 'Failed to refresh shift data. Please try again.',
                icon: 'error'
            });
        }

        // Setup publish button handler
        confirmButton.onclick = () => this.handlePublishConfirm(bsModal);
    },

    handlePublishConfirm: async function (modalInstance) {
        try {
            const currentView = this.calendar.view;
            const viewStart = new Date(`${currentView.activeStart.toISOString().split('T')[0]}T00:00:00Z`);
            const viewEnd = new Date(`${currentView.activeEnd.toISOString().split('T')[0]}T23:59:59.999Z`);
            const adjustedEndDate = new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000);

            // Get all unpublished shifts in current view
            const shiftsToPublish = this.shifts.filter(shift => {
                const shiftDate = new Date(shift.start);
                return shiftDate >= viewStart &&
                    shiftDate < adjustedEndDate &&
                    ['Not Published', 'Re-Publish'].includes(shift.extendedProps.publishStatus);
            });

            if (shiftsToPublish.length === 0) {
                await Swal.fire({
                    title: 'No Shifts to Publish',
                    text: 'There are no unpublished shifts in the current view.',
                    icon: 'info'
                });
                return;
            }

            // Show confirmation dialog
            const confirmResult = await Swal.fire({
                title: 'Publish Shifts',
                text: `Are you sure you want to publish ${shiftsToPublish.length} shifts?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#158E52',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, publish shifts'
            });

            if (!confirmResult.isConfirmed) return;

            // Close the publish modal
            modalInstance.hide();

            // Create and maintain an error log
            const errorLog = [];
            let currentShift = 0;
            let processingCancelled = false;

            const swalContent = document.createElement('div');
            swalContent.className = 'swal2-content';
            swalContent.innerHTML = `
    <div class="publish-progress" style="margin-bottom: 1rem;">
        Publishing ${currentShift} of ${shiftsToPublish.length}
    </div>
    <progress class="swal2-progress-steps" value="0" max="100" style="width: 100%; margin-bottom: 1rem;"></progress>
    <div class="publish-errors" style="color: #dc3545; text-align: left; font-size: 0.9em; max-height: 100px; overflow-y: auto; display: none;">
    </div>
`;

            await Swal.fire({
                title: 'Publishing Shifts',
                html: swalContent,
                allowOutsideClick: false,
                allowEscapeKey: false,
                allowEnterKey: false,
                showCancelButton: true,
                // cancelButtonText: 'Stop Processing',
                showConfirmButton: false,
                didOpen: async (popup) => {
                    const progressBar = popup.querySelector('.swal2-progress-steps');
                    const progressText = popup.querySelector('.publish-progress');
                    const errorContainer = popup.querySelector('.publish-errors');

                    const updateProgress = () => {
                        const progress = (currentShift / shiftsToPublish.length) * 100;
                        progressBar.value = progress;
                        progressText.textContent = `Publishing ${currentShift} of ${shiftsToPublish.length}`;
                    };

                    const updateErrorDisplay = (error) => {
                        errorContainer.style.display = 'block';
                        errorContainer.innerHTML = errorLog.map(err =>
                            `<div style="margin-bottom: 0.5rem;">
                    <strong>Error with shift ${err.shiftId}:</strong> ${err.message}
                </div>`
                        ).join('');
                    };

                    // Process each shift
                    for (const shift of shiftsToPublish) {
                        if (processingCancelled) break;

                        currentShift++;
                        updateProgress();

                        try {
                            await this.updateShiftPublishStatus(shift.id);

                            // Update local data and UI without refetching
                            const calendarEvent = this.calendar.getEventById(shift.id);
                            if (calendarEvent) {
                                calendarEvent.setExtendedProp('publishStatus', 'Published');
                                calendarEvent.setProp('title', calendarEvent.title);
                            }
                        } catch (error) {
                            console.error('Error publishing shift:', error);
                            errorLog.push({
                                shiftId: shift.id,
                                message: error.message || 'Failed to publish shift'
                            });
                            updateErrorDisplay();
                        }
                    }

                    // Final handling
                    if (errorLog.length > 0) {
                        await Swal.fire({
                            title: 'Publishing Complete with Errors',
                            html: `
                    <div style="text-align: left;">
                        <p>Published ${shiftsToPublish.length - errorLog.length} of ${shiftsToPublish.length} shifts.</p>
                        <p>Failed to publish ${errorLog.length} shifts:</p>
                        <div style="max-height: 200px; overflow-y: auto; margin-top: 1rem;">
                            ${errorLog.map(err =>
                                `<div style="margin-bottom: 0.5rem; color: #dc3545;">
                                    <strong>Shift ${err.shiftId}:</strong> ${err.message}
                                </div>`
                            ).join('')}
                        </div>
                    </div>
                `,
                            icon: 'warning'
                        });
                    } else if (!processingCancelled) {
                        await Swal.fire({
                            title: 'Success!',
                            text: `Successfully published ${shiftsToPublish.length} shifts`,
                            icon: 'success'
                        });
                    }

                    // Always refresh events at the end
                    await this.refreshEvents();
                },
                willClose: () => {
                    processingCancelled = true;
                }
            });

        } catch (error) {
            console.error('Error in publish process:', error);
            await Swal.fire({
                title: 'Error',
                text: 'Failed to complete the publishing process. Please try again.',
                icon: 'error'
            });
            await this.refreshEvents();
        }
    },

    updateShiftPublishStatus: function (shiftId) {

        // Simulate error for specific shifts (e.g., every third shift)
        // if (parseInt(shiftId) % 3 === 0) {
        // return new Promise((resolve, reject) => {
        //     reject(new Error(`Simulated error for shift ${shiftId}: Server timeout`));
        // });
        // }

        const form = new FormData();
        form.append('field_478', 'Published');

        return new Promise((resolve, reject) => {
            $.ajax({
                url: `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records/${shiftId}`,
                method: "POST",
                timeout: 0,
                headers: {
                    "X-Tadabase-App-id": this.tb_app_id,
                    "X-Tadabase-App-Key": this.tb_app_key,
                    "X-Tadabase-App-Secret": this.tb_app_secret
                },
                data: form,
                processData: false,
                contentType: false,
                success: function (response) {
                    resolve(response);
                },
                error: function (error) {
                    reject(error);
                }
            });
        });
    },

    // Process and store tag statistics when processing shifts
    processTagStatistics: function (date) {
        const dateStr = new Date(date).toISOString().split('T')[0];
        if (!this.tagStatistics[dateStr]) {
            this.tagStatistics[dateStr] = {
                serviceCategories: {},
                tagCategories: {}
            };
        }

        // Get all shifts for this date
        const shiftsForDate = this.shifts.filter(shift => {
            const shiftDate = new Date(shift.start).toISOString().split('T')[0];
            return shiftDate === dateStr;
        });

        // Reset counts for this date
        this.tagStatistics[dateStr] = {
            serviceCategories: {},
            tagCategories: {}
        };

        // Process each shift's tags
        shiftsForDate.forEach(shift => {
            if (shift.extendedProps && shift.extendedProps.tags2) {
                shift.extendedProps.tags2.forEach(tag => {
                    // Find the full tag data
                    const tagData = this.tagsTableData.find(t => t.id === tag.id);
                    if (tagData) {
                        // Process Service Category counts
                        const serviceCategory = tagData.field_70 || 'Uncategorized';
                        if (!this.tagStatistics[dateStr].serviceCategories[serviceCategory]) {
                            this.tagStatistics[dateStr].serviceCategories[serviceCategory] = {
                                total: 0,
                                tags: {}
                            };
                        }
                        this.tagStatistics[dateStr].serviceCategories[serviceCategory].total++;

                        // Track individual tags within service category
                        if (!this.tagStatistics[dateStr].serviceCategories[serviceCategory].tags[tag.val]) {
                            this.tagStatistics[dateStr].serviceCategories[serviceCategory].tags[tag.val] = 0;
                        }
                        this.tagStatistics[dateStr].serviceCategories[serviceCategory].tags[tag.val]++;

                        // Process Tag Category counts
                        const tagCategory = tagData.field_63 || 'Uncategorized';
                        if (!this.tagStatistics[dateStr].tagCategories[tagCategory]) {
                            this.tagStatistics[dateStr].tagCategories[tagCategory] = {
                                total: 0,
                                tags: {}
                            };
                        }
                        this.tagStatistics[dateStr].tagCategories[tagCategory].total++;

                        // Track individual tags within tag category
                        if (!this.tagStatistics[dateStr].tagCategories[tagCategory].tags[tag.val]) {
                            this.tagStatistics[dateStr].tagCategories[tagCategory].tags[tag.val] = 0;
                        }
                        this.tagStatistics[dateStr].tagCategories[tagCategory].tags[tag.val]++;
                    }
                });
            }
        });
    },

    // Generate HTML for the hover popup
    generateTagStatisticsHTML: function (dateStr) {
        const stats = this.tagStatistics[dateStr];
        if (!stats) return '';

        // Check if there are any categories with data (excluding Uncategorized)
        const hasServiceCategories = Object.entries(stats.serviceCategories)
            .filter(([category]) => category !== 'Uncategorized')
            .length > 0;
        const hasTagCategories = Object.entries(stats.tagCategories).length > 0;

        // If no categories have data, return empty string to prevent popup
        if (!hasServiceCategories && !hasTagCategories) return '';

        let html = `
<div class="tag-stats-popup" style="display: grid; grid-template-columns: 1fr 1px 1fr; gap: 16px; width: 450px;">
    <!-- Service Categories Column -->
    <div style="min-width: 0;">
        <h6 style="color: var(--chhj-orange); border-bottom: 2px solid var(--chhj-orange-light); padding-bottom: 8px; margin-bottom: 12px;">
            Service Categories
        </h6>
        ${hasServiceCategories ? Object.entries(stats.serviceCategories)
                .filter(([category]) => category !== 'Uncategorized') // Filter out Uncategorized
                .map(([category, data]) => `
                <div class="category-group" style="margin-bottom: 12px;">
                    <div class="category-header" style="color: var(--chhj-orange); font-weight: 500; margin-bottom: 4px;">
                        ${category} (${data.total})
                    </div>
                    <div class="tag-list" style="padding-left: 12px;">
                        ${Object.entries(data.tags).map(([tag, count]) => `
                            <div class="tag-item" style="margin-bottom: 2px;">
                                <span style="color: var(--chhj-orange); font-weight: 600; font-size: 0.9em;">
                                    ${count}
                                </span> - ${tag}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('') : '<div style="color: #666;">No service categories available</div>'}
    </div>

    <!-- Vertical Divider -->
    <div style="background-color: #eee; height: 100%;"></div>

    <!-- Tag Categories Column -->
    <div style="min-width: 0;">
        <h6 style="color: var(--chhj-green); border-bottom: 2px solid var(--chhj-green-light); padding-bottom: 8px; margin-bottom: 12px;">
            Tag Categories
        </h6>
        ${hasTagCategories ? Object.entries(stats.tagCategories).map(([category, data]) => `
            <div class="category-group" style="margin-bottom: 12px;">
                <div class="category-header" style="color: var(--chhj-green); font-weight: 500; margin-bottom: 4px;">
                    ${category} (${data.total})
                </div>
                <div class="tag-list" style="padding-left: 12px;">
                    ${Object.entries(data.tags).map(([tag, count]) => `
                        <div class="tag-item" style="margin-bottom: 2px;">
                            <span style="color: var(--chhj-green); font-weight: 600; font-size: 0.9em;">
                                ${count}
                            </span> - ${tag}
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('') : '<div style="color: #666;">No tag categories available</div>'}
    </div>
</div>
`;

        return html;
    },

    // Add hover functionality to date headers
    setupDateHeaderHovers: function () {
        // Remove any existing tooltip
        const existingTooltip = document.querySelector('.tag-stats-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }

        // Create a single tooltip element
        const tooltip = document.createElement('div');
        tooltip.className = 'tag-stats-tooltip';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);

        const handleHeaderHover = (headerCell) => {
            // Get date from the th element's data attribute
            const dateStr = headerCell.getAttribute('data-date');
            if (!dateStr) return;

            // Process statistics for this date
            this.processTagStatistics(dateStr);

            // Create event handlers
            const showTooltip = (e) => {
                const tooltipContent = this.generateTagStatisticsHTML(dateStr);

                // Only show tooltip if there's content
                if (!tooltipContent) return;

                const tooltip = document.querySelector('.tag-stats-tooltip');
                const rect = e.target.getBoundingClientRect();  // Use the actual hovered element
                tooltip.innerHTML = tooltipContent;
                tooltip.style.display = 'block';

                // Position tooltip considering scroll
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

                // Calculate initial position
                let top = rect.bottom + scrollTop + 5;
                let left = rect.left + scrollLeft;

                // Adjust for viewport boundaries
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const tooltipRect = tooltip.getBoundingClientRect();

                // Adjust horizontal position if needed
                if (left + tooltipRect.width > viewportWidth) {
                    left = Math.max(0, viewportWidth - tooltipRect.width - 10);
                }

                // Adjust vertical position if needed
                if (top + tooltipRect.height > viewportHeight + scrollTop) {
                    top = rect.top + scrollTop - tooltipRect.height - 5;
                }

                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${top}px`;
            };

            const hideTooltip = () => {
                const tooltip = document.querySelector('.tag-stats-tooltip');
                if (tooltip) tooltip.style.display = 'none';
            };

            // Use MutationObserver to watch for the count element being added
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.classList && node.classList.contains('hunkpro-header-count')) {
                            // Remove any existing listeners
                            node.removeEventListener('mouseenter', showTooltip);
                            node.removeEventListener('mouseleave', hideTooltip);

                            // Add new listeners
                            node.addEventListener('mouseenter', showTooltip);
                            node.addEventListener('mouseleave', hideTooltip);
                        }
                    });
                });
            });

            // Start observing the header cell for changes
            observer.observe(headerCell, { childList: true });

            // Store observer reference for cleanup
            headerCell._countObserver = observer;
        };

        const initializeHeaderHovers = () => {
            // Select all header cells with data-date attribute
            const headerCells = this.calendar.el.querySelectorAll('th[data-date]');
            headerCells.forEach(handleHeaderHover);
        };

        // Initialize on calendar view changes
        this.calendar.on('datesSet', () => {
            setTimeout(initializeHeaderHovers, 100);
        });

        // Initial setup
        setTimeout(initializeHeaderHovers, 100);

        // Handle window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            tooltip.style.display = 'none';
            resizeTimeout = setTimeout(() => {
                initializeHeaderHovers();
            }, 150);
        });

        // Cleanup on calendar destroy
        this.calendar.on('destroy', () => {
            tooltip.remove();
            // Cleanup all observers
            const headerCells = this.calendar.el.querySelectorAll('th[data-date]');
            headerCells.forEach(cell => {
                if (cell._countObserver) {
                    cell._countObserver.disconnect();
                    delete cell._countObserver;
                }
            });
        });
    },

    fetchTagsData: function () {
        return CacheUtility.fetchWithCache({
            cacheKey: 'tagsData',
            cacheDuration: 3600000, // 1 hour
            validator: (data) => Array.isArray(data) && data.every(item =>
                item.hasOwnProperty('id') &&
                item.hasOwnProperty('field_43') &&
                item.hasOwnProperty('field_63')
            ),
            apiCall: async () => {
                // Helper function to fetch a single page
                const fetchPage = async (page) => {
                    console.log(`Tags Data ::: fetchPage ${page}`);
                    const response = await $.ajax({
                        url: "https://api.tadabase.io/api/v1/data-tables/q3kjZVj6Vb/records",
                        method: "GET",
                        timeout: 5000,
                        headers: {
                            "X-Tadabase-App-id": this.tb_app_id,
                            "X-Tadabase-App-Key": this.tb_app_key,
                            "X-Tadabase-App-Secret": this.tb_app_secret
                        },
                        data: {
                            limit: 100,
                            page: page
                        }
                    });
                    return typeof response === 'string' ? JSON.parse(response) : response;
                };

                let allItems = [];
                let currentPage = 1;
                let totalPages = 1;

                // First request to get initial data and total pages
                const firstPageData = await fetchPage(currentPage);
                totalPages = firstPageData.total_pages;
                allItems = [...firstPageData.items];

                // Fetch remaining pages if any
                while (currentPage < totalPages) {
                    currentPage++;
                    const nextPageData = await fetchPage(currentPage);
                    allItems = [...allItems, ...nextPageData.items];
                }

                return allItems;
            },
            processData: (data) => {
                this.tagsTableData = data; // Store in HunkProScheduler instance
                return data;
            },
            useExpiredCache: true // Allow using expired cache as fallback
        });
    },

    // Helper method to clear all caches (useful for debugging or force refresh)
    clearCaches: function () {
        localStorage.removeItem('employeesData');
        localStorage.removeItem('tagsData');
        console.log('All caches cleared');
    },



    showFullScreenLoader: function () {
        const loader = document.querySelector('.chhj-fullscreen-loader');
        if (loader) {
            loader.style.display = 'flex';
        }
    },

    hideFullScreenLoader: function () {
        const loader = document.querySelector('.chhj-fullscreen-loader');
        if (loader) {
            loader.style.display = 'none';

            // Calculate and log the total load time
            const loadEndTime = performance.now();
            const totalLoadTime = loadEndTime - window.pageLoadStart;
            console.log(`Total Page Load Time: ${totalLoadTime.toFixed(2)}ms (${(totalLoadTime / 1000).toFixed(2)} seconds)`);
        }
    },

    init: async function () {
        this.showFullScreenLoader(); // Show loader before starting initialization

        try {
            // Add jQuery dependency before FullCalendar
            await new Promise((resolve) => {
                const jqueryScript = document.createElement('script');
                jqueryScript.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
                jqueryScript.onload = resolve;
                document.head.appendChild(jqueryScript);
            });



            // Load FullCalendar
            await new Promise((resolve) => {
                const scriptElement = document.createElement('script');
                scriptElement.src = 'https://cdn.jsdelivr.net/npm/fullcalendar-scheduler@6.1.15/index.global.min.js';
                scriptElement.onload = () => {
                    this.FullCalendar = window.FullCalendar;
                    window.FullCalendar = null;
                    resolve();
                };
                document.head.appendChild(scriptElement);
            });


            // await this.fetchTagsData();

            // Load initial data
            // const employees = await this.fetchEmployees();

            const [tagsData, employees] = await Promise.all([
                this.fetchTagsData(),
                this.fetchEmployees()
            ]);

            this.initializeCalendar(employees);

            // Makes sure that the refresh event finishes
            const refreshPromise = new Promise((resolve, reject) => {
                const checkRefresh = () => {
                    if (!this.isRefreshing) {
                        resolve();
                    } else {
                        setTimeout(checkRefresh, 100);
                    }
                };

                this.refreshEvents()
                    .then(() => {
                        checkRefresh();
                    })
                    .catch(reject);
            });
            await refreshPromise;

            // Add this after calendar is fully initialized
            // this.communicateHeight();

            // await this.fetchTagsData();

            this.hideFullScreenLoader();

            // Add in init after calendar initialization
            $(document).on('change', '.filter-tag, .filter-position', () => {
                this.applyFilters();
            });

            $(document).on('click', '.clear-tag-filters', () => {
                $('.filter-tag').prop('checked', false);
                this.applyFilters();
            });

            $(document).on('click', '.clear-position-filters', () => {
                $('.filter-position').prop('checked', false);
                this.applyFilters();
            });

            // Close dropdowns when clicking outside
            $(document).on('click', (e) => {
                if (!$(e.target).closest('.dropdown-menu, .fc-filterTag-button, .fc-filterPosition-button').length) {
                    $('.dropdown-menu').removeClass('show');
                }
            });



        } catch (error) {
            console.error('Initialization error:', error);
            // Show error in loader
            const loaderText = document.querySelector('.chhj-loader-text');
            const loaderDetails = document.querySelector('.chhj-loader-details');
            if (loaderText) loaderText.textContent = 'Error loading schedule';
            if (loaderDetails) loaderDetails.textContent = 'Please refresh the page to try again';
        }
    },

    fetchEmployees: function () {
        return CacheUtility.fetchWithCache({
            cacheKey: 'employeesData',
            cacheDuration: 1800000, // 30 minutes
            validator: (data) => Array.isArray(data) && data.every(item =>
                item.hasOwnProperty('id') &&
                item.hasOwnProperty('title') &&
                item.hasOwnProperty('extendedProps')
            ),
            apiCall: async () => {
                // Helper function to fetch a single page
                const fetchPage = async (page) => {
                    console.log(`Employees ::: fetchPage ${page}`);
                    const response = await $.ajax({
                        url: `https://api.tadabase.io/api/v1/data-tables/4MXQJdrZ6v/records`,
                        method: "GET",
                        timeout: 0,
                        headers: {
                            "X-Tadabase-App-id": this.tb_app_id,
                            "X-Tadabase-App-Key": this.tb_app_key,
                            "X-Tadabase-App-Secret": this.tb_app_secret
                        },
                        data: {
                            filters: {
                                items: [{
                                    field_id: 'field_427',
                                    operator: 'contains_any',
                                    val: 'Truck Operations'
                                }, {
                                    field_id: 'status',
                                    operator: 'is',
                                    val: 'Active'
                                }]
                            },
                            limit: 100,
                            page: page
                        }
                    });
                    return typeof response === 'string' ? JSON.parse(response) : response;
                };

                let allItems = [];
                let currentPage = 1;
                let totalPages = 1;

                // First request to get initial data and total pages
                const firstPageData = await fetchPage(currentPage);
                totalPages = firstPageData.total_pages;
                allItems = [...firstPageData.items];

                // Fetch remaining pages if any
                while (currentPage < totalPages) {
                    currentPage++;
                    const nextPageData = await fetchPage(currentPage);
                    allItems = [...allItems, ...nextPageData.items];
                }

                return allItems;
            },
            processData: (items) => {
                return items.map(item => {
                    let employee = {
                        id: item.id,
                        title: item.cached ? item.title : item.name,
                        extendedProps: item.cached ? item.extendedProps : {
                            department: item.field_427 || [],
                            status: item.status,
                            weeklyShifts: 0,
                            position: item.field_395_val,
                            tags: item.field_62_val || []
                        },
                        cached: true
                    };
                    // console.log('processData: employee', employee);
                    return employee;
                });
            },
            useExpiredCache: true // Allow using expired cache as fallback
        });
    },


    fetchSchedules: function () {
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        const startDate = viewStart.toISOString().split('T')[0];
        const endDate = viewEnd.toISOString().split('T')[0];

        // Helper function to fetch a single page
        const fetchPage = async (page) => {
            console.log(`Schedules ::: fetchPage ${page}`);
            return new Promise((resolve, reject) => {
                $.ajax({
                    "url": `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records?filters[items][0][field_id]=field_60&filters[items][0][operator]=is%20on%20or%20after&filters[items][0][val]=${startDate}&filters[items][1][field_id]=field_60&filters[items][1][operator]=is%20on%20or%20before&filters[items][1][val]=${endDate}&limit=100&page=${page}`,
                    "method": "GET",
                    "timeout": 0,
                    "headers": {
                        "X-Tadabase-App-id": this.tb_app_id,
                        "X-Tadabase-App-Key": this.tb_app_key,
                        "X-Tadabase-App-Secret": this.tb_app_secret
                    },
                    "processData": false,
                    "mimeType": "multipart/form-data",
                    "contentType": false,
                    success: function (data) {
                        resolve(JSON.parse(data));
                    },
                    error: function (error) {
                        reject(error);
                    }
                });
            });
        };

        // Main function to handle pagination and combine results
        return new Promise(async (resolve, reject) => {
            try {
                let allItems = [];
                let currentPage = 1;
                let totalPages = 1;

                // First request to get initial data and total pages
                const firstPageData = await fetchPage(currentPage);
                totalPages = firstPageData.total_pages;
                allItems = [...firstPageData.items];

                // Fetch remaining pages if any
                while (currentPage < totalPages) {
                    currentPage++;
                    const nextPageData = await fetchPage(currentPage);
                    allItems = [...allItems, ...nextPageData.items];
                }

                // Process all collected items
                const schedules = allItems.map(item => {
                    try {
                        // Get the full position name
                        let positionName = '';
                        if (item.field_59_val &&
                            Array.isArray(item.field_59_val) &&
                            item.field_59_val[0] &&
                            item.field_59_val[0].val) {
                            positionName = item.field_59_val[0].val;
                        } else {
                            console.warn('Invalid position data for item:', item);
                            positionName = 'Unknown Position';
                        }

                        // Get the CSS class based on position name
                        const cssClass = this.positionClassMap[positionName] || 'hunkpro-shift-default';

                        // Ensure we have valid resourceId
                        const resourceId = Array.isArray(item.field_58) ? item.field_58[0] : item.field_58;
                        if (!resourceId) {
                            console.warn('Missing resourceId for item:', item);
                            return null;
                        }

                        return {
                            id: item.id,
                            resourceId: resourceId,
                            title: positionName,
                            positionId: item.field_59,
                            start: item.field_60,
                            classNames: [cssClass],
                            allDay: true,
                            resourceEditable: false,
                            extendedProps: {
                                hasNotes: item.field_479 !== null && item.field_479 !== '',
                                publishStatus: item.field_478 || 'unknown',
                                tags: item.field_477 || [],
                                notes: item.field_479,
                                tags2: item.field_477_val
                            }
                        };
                    } catch (err) {
                        console.error('Error processing schedule item:', err, item);
                        return null;
                    }
                }).filter(schedule => schedule !== null);

                resolve(schedules);

            } catch (error) {
                console.error('Error fetching schedules:', error);
                reject(error);
            }
        });
    },
    fetchAvailability: function () {
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // Add buffer days
        const bufferStart = new Date(viewStart);
        bufferStart.setDate(bufferStart.getDate() - 7);

        const bufferEnd = new Date(viewEnd);
        bufferEnd.setDate(bufferEnd.getDate() + 7);

        const startDate = bufferStart.toISOString().split('T')[0];
        const endDate = bufferEnd.toISOString().split('T')[0];

        const classMap = this.availabilityClassMap;

        // Helper function to fetch a single page
        const fetchPage = async (page) => {
            console.log(`Availability ::: fetchPage ${page}`);
            return new Promise((resolve, reject) => {
                $.ajax({
                    "url": `https://api.tadabase.io/api/v1/data-tables/eykNOvrDY3/records?filters[items][0][field_id]=field_428-start&filters[items][0][operator]=is%20on%20or%20before&filters[items][0][val]=${endDate}&filters[items][1][field_id]=field_428-end&filters[items][1][operator]=is%20on%20or%20after&filters[items][1][val]=${startDate}&filters[items][2][field_id]=field_67&filters[items][2][operator]=is%20not&filters[items][2][val]=Regular%20Day%20Off&limit=100&page=${page}`,
                    "method": "GET",
                    "timeout": 0,
                    "headers": {
                        "X-Tadabase-App-id": this.tb_app_id,
                        "X-Tadabase-App-Key": this.tb_app_key,
                        "X-Tadabase-App-Secret": this.tb_app_secret
                    },
                    "processData": false,
                    "mimeType": "multipart/form-data",
                    "contentType": false,
                    success: function (data) {
                        resolve(JSON.parse(data));
                    },
                    error: function (error) {
                        reject(error);
                    }
                });
            });
        };

        // Main function to handle pagination and combine results
        return new Promise(async (resolve, reject) => {
            try {
                let allItems = [];
                let currentPage = 1;
                let totalPages = 1;

                // First request to get initial data and total pages
                const firstPageData = await fetchPage(currentPage);
                totalPages = firstPageData.total_pages;
                allItems = [...firstPageData.items];

                // Fetch remaining pages if any
                while (currentPage < totalPages) {
                    currentPage++;
                    const nextPageData = await fetchPage(currentPage);
                    allItems = [...allItems, ...nextPageData.items];
                }

                // Process all collected items
                const availability = allItems.map(item => {
                    try {
                        const start = item.field_428.start.split(' ')[0];
                        // Add one day to the end date to make it inclusive
                        const endDate = new Date(item.field_428.end.split(' ')[0]);
                        endDate.setDate(endDate.getDate() + 1);
                        const end = endDate.toISOString().split('T')[0];

                        // Get the availability type and find corresponding CSS class
                        const availabilityType = item.field_67 || 'Regular Day Off';
                        const cssClass = classMap[availabilityType] || 'hunkpro-unavailable-regular';

                        return {
                            id: item.id,
                            resourceId: item.field_64[0],
                            start: `${start}T00:00:00`,
                            end: `${end}T00:00:00`,
                            title: availabilityType,
                            display: 'background',
                            textColor: 'black',
                            classNames: [cssClass, 'hunkpro-unavailable-text']
                        };
                    } catch (error) {
                        console.error('Error processing availability item:', error, item);
                        return null;
                    }
                }).filter(event => event !== null);

                resolve(availability);
            } catch (error) {
                console.error('Error fetching availability:', error);
                reject(error);
            }
        });
    },
    fetchRegularDayOffs: function () {
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // console.log(`fetchRegularDayOffs ${viewStart} ${viewEnd}`);

        // Add buffer days just like in fetchAvailability
        const bufferStart = new Date(viewStart);
        bufferStart.setDate(bufferStart.getDate() - 7);

        const bufferEnd = new Date(viewEnd);
        bufferEnd.setDate(bufferEnd.getDate() + 7);

        const startDate = bufferStart.toISOString().split('T')[0];
        const endDate = bufferEnd.toISOString().split('T')[0];

        // console.log(`fetchRegularDayOffs ${startDate} ${endDate}`);

        // Helper function to make API call
        const makeApiCall = async () => {
            return new Promise((resolve, reject) => {
                $.ajax({
                    url: `https://api.tadabase.io/api/v1/data-tables/eykNOvrDY3/records?filters[items][0][field_id]=field_67&filters[items][0][operator]=is&filters[items][0][val]=Regular%20Day%20Off&filters[items][1][field_id]=field_428-start&filters[items][1][operator]=is%20on%20or%20before&filters[items][1][val]=${endDate}&filters[items][2][field_id]=field_428-end&filters[items][2][operator]=is%20on%20or%20after&filters[items][2][val]=${startDate}`,
                    method: "GET",
                    timeout: 0,
                    headers: {
                        "X-Tadabase-App-id": this.tb_app_id,
                        "X-Tadabase-App-Key": this.tb_app_key,
                        "X-Tadabase-App-Secret": this.tb_app_secret
                    },
                    processData: false,
                    mimeType: "multipart/form-data",
                    contentType: false,
                    success: function (data) {
                        resolve(JSON.parse(data));
                    },
                    error: function (error) {
                        reject(error);
                    }
                });
            });
        };

        return new Promise((resolve, reject) => {
            makeApiCall()
                .then((data) => {
                    let availability = [];

                    data.items.forEach(item => {
                        if (item.field_67 === 'Regular Day Off' && Array.isArray(item.field_475) && item.field_475.length > 0) {
                            const dayMapping = {
                                'Sunday': 0,
                                'Monday': 1,
                                'Tuesday': 2,
                                'Wednesday': 3,
                                'Thursday': 4,
                                'Friday': 5,
                                'Saturday': 6
                            };

                            // Get the selected days of the week
                            const selectedDays = item.field_475.filter(day => day !== "").map(day => dayMapping[day]);

                            // Create events for each selected day within the view range
                            let currentDate = new Date(viewStart);

                            while (currentDate < viewEnd) {
                                if (selectedDays.includes(currentDate.getDay())) {
                                    // Set the time to noon to avoid timezone issues
                                    const eventDate = new Date(currentDate);
                                    // eventDate.setHours(12, 0, 0, 0);
                                    const formattedEventDate = eventDate.toISOString().split('T')[0];

                                    // Create next day date properly
                                    const nextDay = new Date(eventDate);
                                    nextDay.setDate(nextDay.getDate() + 1);
                                    const formattedNextDay = nextDay.toISOString().split('T')[0];

                                    const hasExistingAvailability = this.availability.some(avail => {
                                        // Normalize start date to beginning of day
                                        const availStartDate = new Date(avail.start);
                                        // availStartDate.setHours(0, 0, 0, 0);

                                        // Normalize end date to end of day
                                        // Also subtract one day since end dates are exclusive
                                        const availEndDate = new Date(avail.end);
                                        availEndDate.setDate(availEndDate.getDate() - 1);
                                        // availEndDate.setHours(23, 59, 59, 999);

                                        // Normalize check date to noon
                                        const checkDate = new Date(eventDate);
                                        // checkDate.setHours(12, 0, 0, 0);

                                        // Compare dates with normalized timestamps
                                        return avail.resourceId === item.field_64[0] &&
                                            checkDate >= availStartDate &&
                                            checkDate <= availEndDate;
                                    });

                                    // Only add regular day off if there's no existing availability
                                    if (!hasExistingAvailability) {
                                        availability.push({
                                            id: `${item.id}-${formattedEventDate}`,
                                            resourceId: item.field_64[0],
                                            start: `${formattedEventDate}T00:00:00`,
                                            end: `${formattedNextDay}T00:00:00`,
                                            title: 'Regular Day Off',
                                            display: 'background',
                                            textColor: 'black',
                                            classNames: ['hunkpro-unavailable-regular', 'hunkpro-unavailable-text']
                                        });
                                    }
                                }
                                currentDate.setDate(currentDate.getDate() + 1);
                            }
                        }
                    });

                    resolve(availability);
                })
                .catch(error => {
                    console.error('Error fetching regular day offs:', error);
                    reject(error);
                });
        });
    },
    addShift: function (newShift) {
        const form = new FormData();
        form.append('field_60', newShift.date); // Date
        form.append('field_58', newShift.user); // Employee
        form.append('field_59', newShift.position); // Position
        form.append('field_477', newShift.tags); // Tags
        form.append('field_478', 'Not Published');

        if (newShift.notes) {
            form.append('field_479', newShift.notes); // Notes
        }

        // Rest of the addShift method remains the same...
        return new Promise((resolve, reject) => {
            $.ajax({
                url: `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records`,
                method: "POST",
                timeout: 0,
                headers: {
                    "X-Tadabase-App-id": this.tb_app_id,
                    "X-Tadabase-App-Key": this.tb_app_key,
                    "X-Tadabase-App-Secret": this.tb_app_secret
                },
                data: form,
                processData: false,
                contentType: false,
                success: (response) => {
                    console.log('Add Shift Response:', response);
                    this.clearAllOverrides();
                    // this.refreshEvents().then(resolve).catch(reject);
                    resolve({
                        id: response.recordId, // Use the recordId from the response
                        ...response
                    });
                },
                error: (error) => {
                    console.error('Error adding shift:', error);
                    reject(error);
                }
            });
        });
    },

    updateShift: function (shift) {
        // Create FormData object
        console.log('updateShift', shift);
        const form = new FormData();
        form.append('field_60', shift.date); // Date
        // form.append('field_58', shift.user); // Employee
        form.append('field_59', shift.position); // Position

        if (shift.tags) {
            form.append('field_477', shift.tags); // Tags
        }

        if (shift.notes !== undefined) {
            form.append('field_479', shift.notes); // Notes
        }

        // Add publish status to the update
        if (shift.publishStatus) {
            form.append('field_478', shift.publishStatus); // Publish Status
        }

        // Store reference to 'this' for use in callback
        const self = this;

        // Return promise for better error handling
        return new Promise((resolve, reject) => {
            $.ajax({
                url: `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records/${shift.id}`,
                method: "POST",
                timeout: 0,
                headers: {
                    "X-Tadabase-App-id": this.tb_app_id,
                    "X-Tadabase-App-Key": this.tb_app_key,
                    "X-Tadabase-App-Secret": this.tb_app_secret
                },
                data: form,
                processData: false,
                contentType: false,
                success: function (response) {
                    console.log('Edit Shift Response:', response);
                    // Refresh events after successful addition
                    // self.refreshEvents().then(resolve).catch(reject);

                    resolve({
                        id: shift.id, // Keep the existing ID for updates
                        ...response
                    });
                },
                error: function (error) {
                    console.error('Error editing shift:', error);
                    reject(error);
                }
            });
        });
    },

    // Add this helper method to HunkProScheduler
    fetchScheduleById: async function (shiftId) {
        return new Promise((resolve, reject) => {
            $.ajax({
                url: `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records/${shiftId}`,
                method: "GET",
                timeout: 0,
                headers: {
                    "X-Tadabase-App-id": this.tb_app_id,
                    "X-Tadabase-App-Key": this.tb_app_key,
                    "X-Tadabase-App-Secret": this.tb_app_secret
                },
                success: (response) => {
                    try {
                        if (!response?.item) {
                            throw new Error('Invalid response format');
                        }

                        const item = response.item;

                        // Get employee data to find position information
                        const employeeId = item.field_58[0];
                        const employee = this.calendar.getResourceById(employeeId);

                        // Find position name from employee's position data
                        const positionId = item.field_59[0];
                        const positionData = employee?._resource?.extendedProps?.position?.find(
                            p => p.id === positionId
                        );

                        const positionName = positionData?.val || 'Unknown Position';
                        const cssClass = this.positionClassMap[positionName] || 'hunkpro-shift-default';

                        // Process the shift data
                        const processedShift = {
                            id: item.id,
                            resourceId: employeeId,
                            title: positionName,
                            start: item.field_60,
                            allDay: true,
                            classNames: [cssClass],
                            resourceEditable: false,
                            extendedProps: {
                                publishStatus: item.field_478 || 'Not Published',
                                hasNotes: item.field_479 ? true : false,
                                notes: item.field_479 || '',
                                tags: item.field_477 || [],
                                tags2: item.field_477?.map(tagId => {
                                    const tagData = this.tagsTableData.find(t => t.id === tagId);
                                    return {
                                        id: tagId,
                                        val: tagData?.field_43 || 'Unknown Tag'
                                    };
                                }) || [],
                                positionId: item.field_59
                            }
                        };

                        resolve(processedShift);
                    } catch (error) {
                        console.error('Error processing schedule data:', error);
                        reject(error);
                    }
                },
                error: function (error) {
                    reject(error);
                }
            });
        });
    },

    loadData: async function () {
        try {
            // First fetch employees since we need them to initialize the calendar
            const employees = await this.fetchEmployees();

            // Initialize calendar before fetching schedules
            this.initializeCalendar(employees);

            // Initial data load
            await this.refreshEvents(true); // true indicates initial load
        } catch (error) {
            console.error('Error loading data:', error);
            await Swal.fire({
                title: 'Error',
                text: 'Failed to load schedule data. Please refresh the page.',
                icon: 'error'
            });
        }
    },



    createResourceContent: function (title, shiftCount) {
        const container = document.createElement('div');
        container.className = 'hunkpro-resource-content';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'hunkpro-employee-name';
        nameDiv.textContent = title;

        const shiftsDiv = document.createElement('div');
        shiftsDiv.className = 'hunkpro-shift-count';
        shiftsDiv.textContent = `${shiftCount} Shifts`;

        const addShiftDiv = document.createElement('div');
        addShiftDiv.className = 'hunkpro-add-shift';
        // addShiftDiv.textContent = '+ + + + + + +';

        container.appendChild(nameDiv);
        container.appendChild(shiftsDiv);
        container.appendChild(addShiftDiv);

        return container;
    },

    // Add this method to count shifts per day
    getDailyShiftCounts: function () {
        const dailyCounts = {};
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // Ensure we include the full last day by setting hours to end of day
        const adjustedViewEnd = new Date(viewEnd);
        // adjustedViewEnd.setHours(23, 59, 59, 999);

        // Initialize counts for each day including the last day
        for (let date = new Date(viewStart); date <= adjustedViewEnd; date.setDate(date.getDate() + 1)) {
            const dateStr = date.toISOString().split('T')[0];
            dailyCounts[dateStr] = 0;
        }

        // Count shifts for each day
        this.shifts.forEach(shift => {
            const shiftDate = new Date(shift.start);
            const dateStr = shiftDate.toISOString().split('T')[0];
            if (dailyCounts.hasOwnProperty(dateStr)) {
                dailyCounts[dateStr]++;
            }
        });

        return dailyCounts;
    },

    createAvailabilityEvents: function (id, resourceId, startDate, endDate, title, className) {
        const events = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Create an event for each day in the range
        for (let date = start; date < end; date.setDate(date.getDate() + 1)) {
            events.push({
                id: `${id}-${date.toISOString().split('T')[0]}`,
                resourceId: resourceId,
                start: date.toISOString().split('T')[0],
                end: new Date(date.setDate(date.getDate() + 1)).toISOString().split('T')[0],
                title: title,
                display: 'background',
                classNames: [className],
            });
            date.setDate(date.getDate() - 1); // Reset the date back since we modified it for end date
        }

        return events;
    },

    refreshEvents: async function (isInitialLoad = false) {
        const now = Date.now();

        // Store the current view dates as the latest request
        this._lastRequestedStart = this.calendar.view.activeStart;
        this._lastRequestedEnd = this.calendar.view.activeEnd;

        // If we're already refreshing or within cooldown, queue this refresh
        if (this.isRefreshing || (!isInitialLoad && now - this.lastRefreshTime < this.REFRESH_COOLDOWN)) {
            // Queue this refresh, but it will use the most recent dates when executed
            this.refreshQueue = this.refreshQueue.then(() => this._executeRefresh(isInitialLoad));
            return this.refreshQueue;
        }

        return this._executeRefresh(isInitialLoad);
    },

    // Private method to handle the actual refresh logic
    _executeRefresh: async function (isInitialLoad) {
        if (this.isRefreshing) return;

        this.isRefreshing = true;
        this.lastRefreshTime = Date.now();
        this.updateRefreshButtonState(true);

        try {
            // Wait for cooldown period before executing fetches
            if (!isInitialLoad) {
                await new Promise(resolve => setTimeout(resolve, this.REFRESH_COOLDOWN));
            }

            // console.log(`Refreshing events... (${isInitialLoad ? 'initial load' : 'update'})`);

            // Use the most recently requested dates instead of current view dates
            const viewStart = this._lastRequestedStart || this.calendar.view.activeStart;
            const viewEnd = this._lastRequestedEnd || this.calendar.view.activeEnd;

            // Clear the stored dates
            this._lastRequestedStart = null;
            this._lastRequestedEnd = null;

            // Fetch data in parallel
            const [schedules, availabilityData] = await Promise.all([
                this.fetchSchedules(),
                this.fetchAvailability()
            ]);

            // Store the availability data first
            this.availability = availabilityData;

            // Then fetch regular day offs
            const regularDayOffs = await this.fetchRegularDayOffs();

            // Store the fetched data
            this.shifts = schedules;
            // Combine regular availability with regular day offs
            this.availability = [...availabilityData, ...regularDayOffs];

            // Remove existing events only after we have new data
            this.calendar.removeAllEvents();

            // Batch add all events
            const allEvents = [
                ...this.shifts.map(shift => ({
                    ...shift,
                    allDay: true
                })),
                ...this.availability.map(avail => ({
                    ...avail,
                    display: 'background',
                    allDay: true
                }))
            ];

            this.calendar.addEventSource(allEvents);

            // Update counts only after all events are added
            await this.updateAllCounts();

            return true;
        } catch (error) {
            console.error('Error refreshing events:', error);
            throw error;
        } finally {
            this.isRefreshing = false;
            this.updateRefreshButtonState(false);
        }
    },

    // Add this function to your HunkProScheduler object
    communicateHeight: function () {
        const sendHeight = () => {
            // Get the total height of the page content
            const totalHeight = document.documentElement.scrollHeight || document.body.scrollHeight;

            // Send message to parent (Tadabase)
            window.parent.postMessage({
                type: 'setHeight',
                height: totalHeight,
                source: 'schedulerCalendar'
            }, '*');
        };

        // Send height after calendar initialization
        this.calendar.on('viewDidMount', sendHeight);

        // Send height after any updates that might affect height
        this.calendar.on('resourceAdd', sendHeight);
        this.calendar.on('resourceRemove', sendHeight);
        this.calendar.on('eventAdd', sendHeight);
        this.calendar.on('eventRemove', sendHeight);

        // Also send height after window resize
        window.addEventListener('resize', () => {
            setTimeout(sendHeight, 100); // Small delay to ensure calendar has updated
        });

        // Initial height communication
        sendHeight();
    },

    initializeCalendar: function (employees) {
        const calendarEl = document.getElementById('hunkpro-calendar');

        this.calendar = new this.FullCalendar.Calendar(calendarEl, {
            initialView: 'resourceTimelineWeek',
            firstDay: 1,
            schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives',
            resources: employees,
            selectable: true,
            editable: true,
            refetchResourcesOnNavigate: true,
            resourceAreaWidth: '200px',
            slotDuration: { days: 1 },
            dayMaxEvents: true,
            displayEventTime: false,
            displayEventEnd: false,

            // Add these height-related settings
            contentHeight: 'auto',
            handleWindowResize: true,

            // Simplified header toolbar
            headerToolbar: {
                left: 'today prev,next filterTag filterPosition',
                center: 'title',
                right: 'publish copyWeek refresh'
            },


            // Custom refresh button
            customButtons: {
                refresh: {
                    text: '↻ Refresh',
                    click: async () => {
                        try {
                            await this.refreshEvents();
                        } catch (error) {
                            console.error('Error refreshing events:', error);
                        }
                    }
                },
                copyWeek: {
                    text: 'Copy Week',
                    click: () => {
                        // console.log("Click copyWeek");
                        this.showCopyWeekDialog();
                    }
                },
                publish: {
                    text: '', // removed the "Publish" text.. this is taken cared of by the updatePublishButton
                    click: () => {
                        this.showPublishDialog();
                    }
                },
                filterTag: {
                    text: 'Filter by Tag',
                    click: (e) => {
                        // Create and update counter span if it doesn't exist
                        let button = e.currentTarget;
                        let counter = button.querySelector('.filter-counter');
                        if (!counter) {
                            counter = document.createElement('span');
                            counter.className = 'filter-counter';
                            button.appendChild(counter);
                        }

                        const tagDropdown = $('#tag-filter-dropdown');
                        const posDropdown = $('#position-filter-dropdown');

                        // Close position dropdown if open
                        posDropdown.removeClass('show');

                        if (!tagDropdown.length) {
                            const dropdown = $(`
                    <div id="tag-filter-dropdown" class="dropdown-menu p-2" style="min-width: 250px">
                        <!-- Tags will be populated here -->
                    </div>
                `).appendTo('body');
                            this.updateTagFilters(dropdown);
                        }
                        const button$ = $(e.currentTarget);
                        const dropdown = $('#tag-filter-dropdown');
                        dropdown.css({
                            top: button$.offset().top + button$.outerHeight(),
                            left: button$.offset().left
                        }).toggleClass('show');
                        e.stopPropagation();
                    }
                },
                filterPosition: {
                    text: 'Filter by Position',
                    click: (e) => {
                        // Create and update counter span if it doesn't exist
                        let button = e.currentTarget;
                        let counter = button.querySelector('.filter-counter');
                        if (!counter) {
                            counter = document.createElement('span');
                            counter.className = 'filter-counter';
                            button.appendChild(counter);
                        }

                        const tagDropdown = $('#tag-filter-dropdown');
                        const posDropdown = $('#position-filter-dropdown');

                        // Close tag dropdown if open
                        tagDropdown.removeClass('show');

                        if (!posDropdown.length) {
                            const dropdown = $(`
                    <div id="position-filter-dropdown" class="dropdown-menu p-2" style="min-width: 250px">
                        <!-- Positions will be populated here -->
                    </div>
                `).appendTo('body');
                            this.updatePositionFilters(dropdown);
                        }
                        const button$ = $(e.currentTarget);
                        const dropdown = $('#position-filter-dropdown');
                        dropdown.css({
                            top: button$.offset().top + button$.outerHeight(),
                            left: button$.offset().left
                        }).toggleClass('show');
                        e.stopPropagation();
                    }
                }
            },

            // Simplified view configuration
            views: {
                resourceTimelineWeek: {
                    type: 'resourceTimeline',
                    duration: { weeks: 1 },
                    slotDuration: { days: 1 },
                    slotLabelFormat: [
                        { weekday: 'short', month: 'numeric', day: 'numeric' }
                    ]
                }
            },

            datesSet: async (dateInfo) => {
                try {
                    // Only refresh if it's a navigation change
                    if (this._lastViewStart?.getTime() !== dateInfo.start.getTime()) {
                        this._lastViewStart = dateInfo.start;

                        // Store current filter states before refresh
                        const selectedTags = $('.filter-tag:checked').map((_, el) => el.value).get();
                        const selectedPositions = $('.filter-position:checked').map((_, el) => el.value).get();

                        // Refresh events
                        await this.refreshEvents();

                        // After refresh, if there were active filters, reapply them
                        if (selectedTags.length > 0 || selectedPositions.length > 0) {
                            // Short delay to ensure DOM is ready
                            setTimeout(() => {
                                // Reselect previously selected filters
                                selectedTags.forEach(tagId => {
                                    $(`#tag-${tagId}`).prop('checked', true);
                                });
                                selectedPositions.forEach(posId => {
                                    $(`#pos-${posId.replace(/\s+/g, '-')}`).prop('checked', true);
                                });

                                // Reapply filters
                                this.applyFilters();

                                // Force layout recalculation
                                this.calendar.updateSize();
                            }, 100);
                        }
                    }
                } catch (error) {
                    console.error('Error in datesSet handler:', error);
                }
            },

            // Resource area configuration
            resourceAreaColumns: [{
                field: 'title',
                headerContent: 'Employee Name',
                cellContent: (arg) => {
                    return {
                        domNodes: [
                            this.createResourceContent(arg.resource.title, arg.resource.extendedProps.weeklyShifts)
                        ]
                    };
                }
            }],

            // Event handlers
            select: (info) => this.handleSelect(info),
            eventClick: (info) => this.handleEventClick(info),
            eventDrop: (info) => this.handleEventDrop(info),

            // Event display configuration
            eventDidMount: (arg) => {
                if (arg.event.display === 'background') {
                    const eventEl = arg.el;
                    eventEl.style.opacity = '0.3';
                    eventEl.title = `${arg.event.title}: ${new Date(arg.event.start).toLocaleDateString()} to ${new Date(arg.event.end).toLocaleDateString()}`;
                }
            },

            // Update the eventContent function in the calendar initialization
            eventContent: (arg) => {
                if (arg.event.display !== 'background') {
                    const hasNotes = arg.event.extendedProps.hasNotes || false;
                    const publishStatus = arg.event.extendedProps.publishStatus || 'unknown';
                    const tags = arg.event.extendedProps.tags2 || [];
                    const syncStatus = arg.event.extendedProps?.syncStatus;

                    // Get status icon info (existing function remains the same)
                    const getStatusIconInfo = (status) => {
                        switch (status) {
                            case 'Not Published':
                                return {
                                    icon: 'publish',
                                    class: 'hunkpro-status-not-published',
                                    title: 'Not Published'
                                };
                            case 'Re-Publish':
                                return {
                                    icon: 'sync',
                                    class: 'hunkpro-status-republish',
                                    title: 'Needs Republishing'
                                };
                            case 'Published':
                                return {
                                    icon: 'check_circle_outline',
                                    class: 'hunkpro-status-published',
                                    title: 'Published'
                                };
                            default:
                                return {
                                    icon: 'help_outline',
                                    class: 'hunkpro-status-unknown',
                                    title: 'Status Unknown'
                                };
                        }
                    };

                    const statusInfo = getStatusIconInfo(publishStatus);

                    // Updated tags processing to handle both initial and refreshed states
                    let processedTags = [];
                    if (Array.isArray(tags)) {
                        processedTags = tags.map(tag => {
                            // Handle both direct tag objects and tag references
                            const tagId = tag.id || tag;
                            const tagData = window.HunkProScheduler.tagsTableData.find(t => t.id === tagId);

                            return {
                                id: tagId,
                                label: tag.val || (tagData ? tagData.field_43 : ''),
                                type: tagData?.field_63?.toLowerCase() || ''
                            };
                        }).filter(tag => tag.label); // Filter out any tags without labels
                    }

                    const tagsHtml = processedTags.length > 0 ? `
            <div class="hunkpro-event-tags">
                ${processedTags.map(tag => `
                    <span class="hunkpro-event-tag ${tag.type === 'tier' ? 'hunkpro-tag-tier' : 'hunkpro-tag-resource'}">
                        ${tag.label}
                    </span>
                `).join('')}
            </div>
        ` : '';

                    const syncStatusHtml = syncStatus ? `
            <div class="sync-status-indicator">
                <div class="sync-${syncStatus}"></div>
            </div>
        ` : '';

                    return {
                        html: `
                <div class="hunkpro-event-wrapper">
                    <div class="hunkpro-event-content">
                        <div class="hunkpro-event-title">${arg.event.title}</div>
                        <div class="hunkpro-event-icons">
                            ${hasNotes ? `
                                <div class="hunkpro-event-icon hunkpro-note-icon" title="Has Notes">
                                    <div class="hunkpro-status-icon">
                                        <span class="material-icons">description</span>
                                    </div>
                                </div>
                            ` : ''}
                            <div class="hunkpro-event-icon ${statusInfo.class}" title="${statusInfo.title}">
                                <div class="hunkpro-status-icon">
                                    <span class="material-icons">${statusInfo.icon}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${tagsHtml}
                    ${syncStatusHtml}
                </div>
            `
                    };
                }
                return `${arg.event.title}`;
            },
        });

        // Initialize calendar
        this.calendar.render();
        this.initializeModalHandlers();
        this.setupDateHeaderHovers();

        // Add window resize handler
        window.addEventListener('resize', () => {
            this.calendar.updateSize();
        });

        // Initial counts update
        setTimeout(() => {
            this.updateAllCounts();
        }, 200);

        // Event change handlers for counts
        const updateOnChange = () => {
            setTimeout(() => {
                this.updateAllCounts();
            }, 100);
        };

        this.calendar.on('eventAdd', updateOnChange);
        this.calendar.on('eventChange', updateOnChange);
        this.calendar.on('eventRemove', updateOnChange);
    },

    updateTagFilters: function (dropdown) {
        const events = this.calendar.getEvents();
        const tags = new Set();

        events.forEach(event => {
            if (event.extendedProps?.tags2) {
                event.extendedProps.tags2.forEach(tag => {
                    tags.add(JSON.stringify({ id: tag.id, label: tag.val }));
                });
            }
        });

        dropdown.empty();
        Array.from(tags).forEach(tagStr => {
            const tag = JSON.parse(tagStr);
            dropdown.append(`
    <div class="form-check  py-2">
        <input class="form-check-input filter-tag" type="checkbox" value="${tag.id}" id="tag-${tag.id}">
        <label class="form-check-label" for="tag-${tag.id}">
            ${tag.label}
        </label>
    </div>
`);
        });

        // Add clear button if needed
        if (tags.size > 0) {
            dropdown.append(`
<div class="dropdown-divider"></div>
<button class="btn btn-link btn-sm clear-tag-filters w-100">Clear Tags</button>
`);
        }
    },

    updatePositionFilters: function (dropdown) {
        const events = this.calendar.getEvents();
        const positions = new Set();

        // Only include regular events (shifts), exclude background events
        events.forEach(event => {
            // Check if it's a regular event (not a background event like availability)
            if (event.display !== 'background' && event.title) {
                positions.add(event.title);
            }
        });

        dropdown.empty();
        Array.from(positions).sort().forEach(position => {
            dropdown.append(`
    <div class="form-check py-2">
        <input class="form-check-input filter-position" type="checkbox" value="${position}" id="pos-${position.replace(/\s+/g, '-')}">
        <label class="form-check-label" for="pos-${position.replace(/\s+/g, '-')}">
            ${position}
        </label>
    </div>
`);
        });

        // Add clear button if needed
        if (positions.size > 0) {
            dropdown.append(`
    <div class="dropdown-divider"></div>
    <button class="btn btn-link btn-sm clear-position-filters w-100">Clear Positions</button>
`);
        }
    },

    applyFilters: function () {
        // Get all selected tags and positions as arrays of values
        const selectedTags = $('.filter-tag:checked').map((_, el) => el.value).get();
        const selectedPositions = $('.filter-position:checked').map((_, el) => el.value).get();

        // Update filter counters
        const tagButton = this.calendar.el.querySelector('.fc-filterTag-button');
        const posButton = this.calendar.el.querySelector('.fc-filterPosition-button');

        // Handle tag counter
        let tagCounter = tagButton.querySelector('.filter-counter');
        if (!tagCounter) {
            tagCounter = document.createElement('span');
            tagCounter.className = 'filter-counter';
            tagButton.appendChild(tagCounter);
        }
        if (selectedTags.length > 0) {
            tagCounter.textContent = ` (${selectedTags.length})`;
            tagCounter.classList.add('active');
        } else {
            tagCounter.textContent = '';
            tagCounter.classList.remove('active');
        }

        // Handle position counter
        let posCounter = posButton.querySelector('.filter-counter');
        if (!posCounter) {
            posCounter = document.createElement('span');
            posCounter.className = 'filter-counter';
            posButton.appendChild(posCounter);
        }
        if (selectedPositions.length > 0) {
            posCounter.textContent = ` (${selectedPositions.length})`;
            posCounter.classList.add('active');
        } else {
            posCounter.textContent = '';
            posCounter.classList.remove('active');
        }

        // Get all events from the calendar
        const events = this.calendar.getEvents();

        // Get both timeline lanes and resource rows - these are the visual elements we'll show/hide
        const resourceLanes = this.calendar.el.querySelectorAll('.fc-timeline-lane[data-resource-id]');
        const resourceRows = this.calendar.el.querySelectorAll('.fc-resource-group,.fc-resource');

        // Create a map to store which resources should be visible
        const visibilityMap = new Map();

        // If no filters selected, show everything and ensure proper layout
        if (selectedTags.length === 0 && selectedPositions.length === 0) {
            resourceLanes.forEach(el => {
                el.style.display = '';
                el.style.height = ''; // Clear any inline height
            });
            resourceRows.forEach(el => {
                el.style.display = '';
                el.style.height = ''; // Clear any inline height
            });

            // Force a layout recalculation
            this.calendar.updateSize();
            return;
        }

        // Process each resource lane
        resourceLanes.forEach(lane => {
            const resourceId = lane.getAttribute('data-resource-id');

            // Get events for this resource
            const resourceEvents = events.filter(event =>
                event.getResources()[0]?.id === resourceId
            );

            // Check if any event matches the filters
            const hasMatch = resourceEvents.some(event => {
                const matchesTags = selectedTags.length === 0 ||
                    event.extendedProps?.tags2?.some(tag =>
                        selectedTags.includes(tag.id)
                    );

                const matchesPosition = selectedPositions.length === 0 ||
                    selectedPositions.includes(event.title);

                return matchesTags && matchesPosition;
            });

            // Store visibility state
            visibilityMap.set(resourceId, hasMatch);

            // Apply visibility to timeline lane
            lane.style.display = hasMatch ? '' : 'none';
        });

        // Apply visibility to resource rows
        resourceRows.forEach(row => {
            // Handle both individual resources and groups
            if (row.classList.contains('fc-resource')) {
                const resourceId = row.getAttribute('data-resource-id');
                const isVisible = visibilityMap.get(resourceId);
                row.style.display = isVisible ? '' : 'none';
            } else if (row.classList.contains('fc-resource-group')) {
                // For groups, check if any child resources are visible
                const childResources = row.querySelectorAll('.fc-resource[data-resource-id]');
                const hasVisibleChild = Array.from(childResources).some(child =>
                    visibilityMap.get(child.getAttribute('data-resource-id'))
                );
                row.style.display = hasVisibleChild ? '' : 'none';
            }
        });

        // Force layout recalculation after a short delay
        setTimeout(() => {
            this.calendar.updateSize();
        }, 50);
    },

    clearFilters: function (type) {
        if (type === 'tag') {
            $('.filter-tag').prop('checked', false);
            const tagCounter = this.calendar.el.querySelector('.fc-filterTag-button .filter-counter');
            tagCounter.textContent = '';
            tagCounter.classList.remove('active');
        } else if (type === 'position') {
            $('.filter-position').prop('checked', false);
            const posCounter = this.calendar.el.querySelector('.fc-filterPosition-button .filter-counter');
            posCounter.textContent = '';
            posCounter.classList.remove('active');
        }

        // Apply filter clearing
        this.applyFilters();

        // Force layout recalculation after a short delay
        setTimeout(() => {
            // Reset any inline styles that might affect layout
            this.calendar.el.querySelectorAll('.fc-timeline-lane, .fc-resource-group, .fc-resource').forEach(el => {
                el.style.height = '';
            });

            this.calendar.updateSize();
        }, 50);
    },

    showCopyWeekDialog: async function () {
        const modal = document.getElementById('hunkpro-copy-week-modal');
        const statsLoader = modal.querySelector('.stats-loader');
        const statsContent = modal.querySelector('.stats-content');
        const dateRange = modal.querySelector('#copy-date-range');
        const confirmButton = modal.querySelector('#confirmCopy');
        const progressSection = modal.querySelector('.copy-progress-section');

        // Get current and next week dates
        const currentView = this.calendar.view;
        const viewStart = new Date(currentView.activeStart);
        const viewEnd = new Date(currentView.activeEnd);
        const adjustedEndDate = new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000);

        // Calculate next week dates
        const nextWeekStart = new Date(viewStart);
        nextWeekStart.setDate(nextWeekStart.getDate() + 7);
        const nextWeekEnd = new Date(adjustedEndDate);
        nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

        // Format dates for display
        const formatDate = (date) => {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        };

        dateRange.innerHTML = `
<strong>From:</strong> ${formatDate(viewStart)} - ${formatDate(adjustedEndDate)}<br>
<strong>To:</strong> ${formatDate(nextWeekStart)} - ${formatDate(nextWeekEnd)}
`;

        // Show modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();

        // Show loader, hide content
        statsLoader.classList.remove('chhj-hide');
        statsContent.classList.add('chhj-hide');
        progressSection.classList.add('chhj-hide');
        confirmButton.disabled = true;

        try {
            // Refresh events to ensure we have latest data
            await this.refreshEvents();

            // Count shifts in current week view
            const shiftsToCount = this.countShiftsToCopy();
            // const existingShifts = await this.countExistingShiftsInTargetWeek(nextWeekStart, nextWeekEnd);

            // Update stats in modal
            modal.querySelector('#shiftsCount').textContent = shiftsToCount;
            // modal.querySelector('#existingCount').textContent = existingShifts;

            // Show content, hide loader
            statsLoader.classList.add('chhj-hide');
            statsContent.classList.remove('chhj-hide');
            confirmButton.disabled = false;

        } catch (error) {
            console.error('Error preparing copy dialog:', error);
            statsLoader.classList.add('chhj-hide');
            statsContent.classList.remove('chhj-hide');
            await Swal.fire({
                title: 'Error',
                text: 'Failed to prepare shift data. Please try again.',
                icon: 'error'
            });
        }

        // Setup confirm button handler
        confirmButton.onclick = () => this.handleCopyConfirm(bsModal);
    },

    countShiftsToCopy: function () {
        const viewStart = new Date(`${this.calendar.view.activeStart.toISOString().split('T')[0]}T00:00:00Z`);
        const viewEnd = new Date(`${this.calendar.view.activeEnd.toISOString().split('T')[0]}T23:59:59.999Z`);
        const adjustedEndDate = new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000);

        const shiftsToCopy = this.shifts.filter(shift => {
            const shiftDate = new Date(`${shift.start}T00:00:00Z`);
            return shiftDate >= viewStart && shiftDate <= adjustedEndDate;
        });

        return shiftsToCopy.length;
    },

    countExistingShiftsInTargetWeek: function (nextWeekStart, nextWeekEnd) {
        // Use local shifts data
        return this.shifts.filter(shift => {
            const shiftDate = new Date(shift.start);
            return shiftDate >= nextWeekStart && shiftDate <= nextWeekEnd;
        }).length;
    },

    handleCopyConfirm: async function (modalInstance) {
        const modal = document.getElementById('hunkpro-copy-week-modal');
        const progressSection = modal.querySelector('.copy-progress-section');
        const confirmButton = modal.querySelector('#confirmCopy');
        const errorLog = modal.querySelector('#error-log');
        const cancelButton = modal.querySelector('.btn-secondary');
        const closeButton = modal.querySelector('.btn-close');
        let isCopying = false;

        try {
            // Get shifts to copy
            const viewStart = new Date(`${this.calendar.view.activeStart.toISOString().split('T')[0]}T00:00:00Z`);
            const viewEnd = new Date(`${this.calendar.view.activeEnd.toISOString().split('T')[0]}T23:59:59.999Z`);
            const adjustedEndDate = new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000);

            const shiftsToCopy = this.shifts.filter(shift => {
                const shiftDate = new Date(`${shift.start}T00:00:00Z`);
                return shiftDate >= viewStart && shiftDate <= adjustedEndDate;
            });

            if (shiftsToCopy.length === 0) {
                await Swal.fire({
                    title: 'No Shifts to Copy',
                    text: 'There are no shifts in the current week to copy.',
                    icon: 'info'
                });
                return;
            }

            // Show confirmation
            const confirmResult = await Swal.fire({
                title: 'Copy Shifts',
                text: `Are you sure you want to copy ${shiftsToCopy.length} shifts to next week?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#158E52',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, copy shifts'
            });

            if (!confirmResult.isConfirmed) return;

            // Prevent modal from closing during copy process
            modalInstance._config.backdrop = 'static';
            modalInstance._config.keyboard = false;
            modal.setAttribute('data-bs-backdrop', 'static');
            modal.setAttribute('data-bs-keyboard', 'false');

            // Disable close and cancel buttons
            closeButton.disabled = true;
            cancelButton.disabled = true;
            isCopying = true;

            // Prepare for copying
            progressSection.classList.remove('chhj-hide');
            confirmButton.disabled = true;
            errorLog.classList.add('chhj-hide');

            // Update progress elements
            const processedCount = modal.querySelector('#processedCount');
            const totalCount = modal.querySelector('#totalCount');
            const progressBar = modal.querySelector('.progress-bar');

            totalCount.textContent = shiftsToCopy.length;
            processedCount.textContent = '0';

            // Track failed copies
            const failedShifts = [];
            let currentShift = 0;

            // Process each shift
            for (const shift of shiftsToCopy) {
                try {
                    currentShift++;
                    // Update progress
                    processedCount.textContent = currentShift;
                    const progress = (currentShift / shiftsToCopy.length) * 100;
                    progressBar.style.width = `${progress}%`;

                    // Calculate new date (7 days later)
                    const newDate = new Date(shift.start);
                    newDate.setDate(newDate.getDate() + 7);

                    // Prepare form data for new shift
                    const form = new FormData();
                    form.append('field_58', shift.resourceId);
                    form.append('field_60', newDate.toISOString().split('T')[0]);
                    form.append('field_59', shift.positionId[0]);
                    form.append('field_478', 'Not Published');

                    console.log("handleCopyConfirm ::: form", form);

                    if (shift.extendedProps.tags) {
                        form.append('field_477', shift.extendedProps.tags.join(","));
                    }

                    if (shift.extendedProps.notes) {
                        form.append('field_479', shift.extendedProps.notes);
                    }

                    // Add the shift
                    await $.ajax({
                        url: 'https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records',
                        method: "POST",
                        headers: {
                            "X-Tadabase-App-id": this.tb_app_id,
                            "X-Tadabase-App-Key": this.tb_app_key,
                            "X-Tadabase-App-Secret": this.tb_app_secret
                        },
                        data: form,
                        processData: false,
                        contentType: false
                    });

                    await new Promise(resolve => setTimeout(resolve, 800));

                } catch (error) {
                    console.error('Error copying shift:', error);
                    failedShifts.push({
                        shift: shift,
                        error: error.message || 'Failed to copy shift'
                    });
                }
            }

            isCopying = false;
            // Re-enable close and cancel buttons
            closeButton.disabled = false;
            cancelButton.disabled = false;

            // Reset modal config
            modalInstance._config.backdrop = true;
            modalInstance._config.keyboard = true;
            modal.removeAttribute('data-bs-backdrop');
            modal.removeAttribute('data-bs-keyboard');

            // Show results
            if (failedShifts.length > 0) {
                errorLog.classList.remove('chhj-hide');
                const errorList = errorLog.querySelector('.error-list');
                errorList.innerHTML = failedShifts.map(failure => `
        <div class="error-item">
            Failed to copy shift for ${failure.shift.resourceId}: ${failure.error}
        </div>
    `).join('');

                const retryBtn = errorLog.querySelector('#retryFailedBtn');
                retryBtn.onclick = () => this.retryFailedShifts(failedShifts);

                await Swal.fire({
                    title: 'Copying Complete with Errors',
                    html: `
            <div style="text-align: left;">
                <p>Copied ${shiftsToCopy.length - failedShifts.length} of ${shiftsToCopy.length} shifts.</p>
                <p>Failed to copy ${failedShifts.length} shifts.</p>
            </div>
        `,
                    icon: 'warning'
                });
            } else {
                await Swal.fire({
                    title: 'Success!',
                    text: `Successfully copied ${shiftsToCopy.length} shifts`,
                    icon: 'success'
                });
                modalInstance.hide();
            }

            // Refresh events
            await this.refreshEvents();

        } catch (error) {
            console.error('Error in copy process:', error);
            await Swal.fire({
                title: 'Error',
                text: 'Failed to complete the copying process. Please try again.',
                icon: 'error'
            });

            // Make sure to re-enable buttons and reset modal state
            if (isCopying) {
                closeButton.disabled = false;
                cancelButton.disabled = false;
                modalInstance._config.backdrop = true;
                modalInstance._config.keyboard = true;
                modal.removeAttribute('data-bs-backdrop');
                modal.removeAttribute('data-bs-keyboard');
            }
        }
    },

    retryFailedShifts: async function (failedShifts) {
        const modal = document.getElementById('hunkpro-copy-week-modal');
        const progressSection = modal.querySelector('.copy-progress-section');
        const errorLog = modal.querySelector('#error-log');
        const retryBtn = errorLog.querySelector('#retryFailedBtn');
        const closeButton = modal.querySelector('.btn-close');
        const cancelButton = modal.querySelector('.btn-secondary');
        let isRetrying = false;

        console.log('failedShifts', failedShifts);

        try {
            // Show retry confirmation
            const confirmResult = await Swal.fire({
                title: 'Retry Failed Shifts',
                text: `Attempt to copy ${failedShifts.length} failed shifts again?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#158E52',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, retry shifts'
            });

            if (!confirmResult.isConfirmed) return;

            // Update modal state
            const modalInstance = bootstrap.Modal.getInstance(modal);
            modalInstance._config.backdrop = 'static';
            modalInstance._config.keyboard = false;
            modal.setAttribute('data-bs-backdrop', 'static');
            modal.setAttribute('data-bs-keyboard', 'false');

            // Disable buttons
            closeButton.disabled = true;
            cancelButton.disabled = true;
            retryBtn.disabled = true;
            isRetrying = true;

            retryBtn.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
    Retrying...
`;

            // Update progress elements
            const processedCount = modal.querySelector('#processedCount');
            const totalCount = modal.querySelector('#totalCount');
            const progressBar = modal.querySelector('.progress-bar');

            totalCount.textContent = failedShifts.length;
            processedCount.textContent = '0';
            progressBar.style.width = '0%';

            // Track new failures
            const newFailures = [];
            let currentShift = 0;



            // Process each failed shift
            for (const failedItem of failedShifts) {
                try {
                    currentShift++;
                    processedCount.textContent = currentShift;
                    const progress = (currentShift / failedShifts.length) * 100;
                    progressBar.style.width = `${progress}%`;

                    const newDate = new Date(failedItem.shift.start);
                    newDate.setDate(newDate.getDate() + 7);

                    const form = new FormData();
                    form.append('field_58', failedItem.shift.resourceId);
                    form.append('field_60', newDate.toISOString().split('T')[0]);
                    form.append('field_59', failedItem.shift.positionId[0]);
                    form.append('field_478', 'Not Published');

                    if (failedItem.shift.extendedProps.tags) {
                        form.append('field_477', failedItem.shift.extendedProps.tags.join(","));
                    }

                    if (failedItem.shift.extendedProps.notes) {
                        form.append('field_479', failedItem.shift.extendedProps.notes);
                    }

                    await $.ajax({
                        url: 'https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records',
                        method: "POST",
                        headers: {
                            "X-Tadabase-App-id": this.tb_app_id,
                            "X-Tadabase-App-Key": this.tb_app_key,
                            "X-Tadabase-App-Secret": this.tb_app_secret
                        },
                        data: form,
                        processData: false,
                        contentType: false
                    });

                    await new Promise(resolve => setTimeout(resolve, 800));

                } catch (error) {
                    console.error('Error retrying shift:', error);
                    newFailures.push({
                        shift: failedItem.shift,
                        error: error.message || 'Failed to copy shift'
                    });
                }
            }

            isRetrying = false;
            // Reset modal state
            closeButton.disabled = false;
            cancelButton.disabled = false;
            modalInstance._config.backdrop = true;
            modalInstance._config.keyboard = true;
            modal.removeAttribute('data-bs-backdrop');
            modal.removeAttribute('data-bs-keyboard');

            if (newFailures.length > 0) {
                errorLog.classList.remove('chhj-hide');
                const errorList = errorLog.querySelector('.error-list');
                errorList.innerHTML = newFailures.map(failure => `
        <div class="error-item">
            Failed to copy shift for ${failure.shift.resourceId}: ${failure.error}
        </div>
    `).join('');

                await Swal.fire({
                    title: 'Retry Complete with Errors',
                    html: `
            <div style="text-align: left;">
                <p>Successfully copied ${failedShifts.length - newFailures.length} of ${failedShifts.length} failed shifts.</p>
                <p>${newFailures.length} shifts still failed to copy.</p>
            </div>
        `,
                    icon: 'warning'
                });

                retryBtn.disabled = false;
                retryBtn.textContent = 'Retry Failed Shifts';
                failedShifts.length = 0;
                failedShifts.push(...newFailures);
            } else {
                await Swal.fire({
                    title: 'Success!',
                    text: `Successfully copied all ${failedShifts.length} failed shifts`,
                    icon: 'success'
                });
                errorLog.classList.add('chhj-hide');
            }

            await this.refreshEvents();

        } catch (error) {
            console.error('Error in retry process:', error);
            await Swal.fire({
                title: 'Error',
                text: 'Failed to complete the retry process. Please try again.',
                icon: 'error'
            });

            if (isRetrying) {
                closeButton.disabled = false;
                cancelButton.disabled = false;
                const modalInstance = bootstrap.Modal.getInstance(modal);
                modalInstance._config.backdrop = true;
                modalInstance._config.keyboard = true;
                modal.removeAttribute('data-bs-backdrop');
                modal.removeAttribute('data-bs-keyboard');
            }

            retryBtn.disabled = false;
            retryBtn.textContent = 'Retry Failed Shifts';
        }
    },

    showCopyWeekDialogV1: function () {
        const currentView = this.calendar.view;
        if (!currentView) {
            console.error('Calendar view not initialized');
            Swal.fire({
                title: 'Error',
                text: 'Calendar not properly initialized. Please refresh the page.',
                icon: 'error'
            });
            return;
        }

        try {
            // Get the formatted dates directly from the view
            const formattedStart = currentView.activeStart.toISOString().split('T')[0];
            const formattedEnd = currentView.activeEnd.toISOString().split('T')[0];

            const weekStart = new Date(
                currentView.activeStart.getFullYear(),
                currentView.activeStart.getMonth(),
                currentView.activeStart.getDate()
            );

            const weekEnd = new Date(
                currentView.activeEnd.getFullYear(),
                currentView.activeEnd.getMonth(),
                currentView.activeEnd.getDate() - 1  // Subtract 1 from end date only if needed for display
            );

            // Calculate next week's dates
            const nextWeekStart = new Date(weekStart);
            nextWeekStart.setDate(nextWeekStart.getDate() + 7);

            const nextWeekEnd = new Date(weekEnd);
            nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

            const formatDate = (date) => {
                return date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                });
            };

            // Format dates for display
            const currentWeekFormatted = formatDate(weekStart) + ' to ' + formatDate(weekEnd);
            const nextWeekFormatted = formatDate(nextWeekStart) + ' to ' + formatDate(nextWeekEnd);

            if (currentWeekFormatted.includes('Invalid Date') || nextWeekFormatted.includes('Invalid Date')) {
                throw new Error('Invalid date formatting');
            }

            // Show the dialog with correct dates
            Swal.fire({
                title: 'Copy Week Schedule',
                html: `
        Do you want to copy schedules from<br>
        <b>${currentWeekFormatted}</b><br>
        to<br>
        <b>${nextWeekFormatted}</b>?
    `,
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#158E52',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, copy schedules',
                showLoaderOnConfirm: true,
                preConfirm: () => {
                    return this.copyWeekSchedulesV1(weekStart, weekEnd)
                        .catch(error => {
                            Swal.showValidationMessage(`Copy failed: ${error.message}`);
                            return false;
                        });
                }
            });

        } catch (error) {
            console.error('showCopyWeekDialog error:', error);
            Swal.fire({
                title: 'Error',
                text: 'Failed to prepare date range for copying. Please try again.',
                icon: 'error'
            });
        }
    },

    copyWeekSchedulesV1: async function (weekStart, weekEnd) {
        if (!weekStart || !weekEnd) {
            throw new Error('Invalid date parameters');
        }

        // Format dates for API call
        const formattedStart = weekStart.toISOString().split('T')[0];
        const formattedEnd = weekEnd.toISOString().split('T')[0];

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(formattedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(formattedEnd)) {
            throw new Error('Invalid date format');
        }

        return new Promise((resolve, reject) => {
            $.ajax({
                url: `https://xrmy-stin-hzw8.n7.xano.io/api:t_v_V8iM/copy_schedules_add_days`,
                method: "GET",
                timeout: 30000, // 30 second timeout
                headers: {
                    "X-Tadabase-App-id": this.tb_app_id,
                    "X-Tadabase-App-Key": this.tb_app_key,
                    "X-Tadabase-App-Secret": this.tb_app_secret,
                    "Authorization": "Bearer h3-6w8xKmnx-WQmh3-8w6xUirs-VUeS"
                },
                data: {
                    start_date: formattedStart,
                    end_date: formattedEnd
                },
                success: (response) => {
                    try {
                        if (!response) {
                            throw new Error('Empty response from server');
                        }

                        // Handle both string and parsed JSON responses
                        const parsedData = typeof response === 'string' ? JSON.parse(response) : response;

                        if (!parsedData) {
                            throw new Error('Failed to parse server response');
                        }

                        console.log('Copy schedules response:', parsedData);
                        resolve(true);
                    } catch (error) {
                        console.error('Error processing response:', error);
                        reject(new Error('Failed to process server response'));
                    }
                },
                error: (jqXHR, textStatus, errorThrown) => {
                    console.error('API Error:', {
                        status: jqXHR.status,
                        textStatus: textStatus,
                        errorThrown: errorThrown
                    });
                    reject(new Error(`Server error: ${textStatus || 'Unknown error'}`));
                }
            });
        });
    },

    handleSelect: function (info) {
        console.log('handleSelect', info);
        const conflict = this.checkAvailability(info.resource.id, info.start);
        console.log('conflict', conflict);
        if (conflict) {
            if (conflict.type === 'shift_conflict') {
                Swal.fire({
                    title: "Cannot Add Schedule",
                    text: "Employee already has a shift scheduled for this day",
                    icon: "error"
                });
            } else if (conflict.type === 'suspension_conflict') {
                Swal.fire({
                    title: "Cannot Add Schedule",
                    text: "Employee is suspended during this period",
                    icon: "error"
                });
            } else {
                Swal.fire({
                    icon: "warning",
                    title: "The employee is unavailable. Are you sure you want to add a schedule?",
                    showDenyButton: true,
                    showCancelButton: true,
                    confirmButtonText: "Yes",
                }).then((result) => {
                    if (result.isConfirmed) {
                        this.clearAllOverrides();
                        this.addOverrideDate(info.resource.id, info.start);
                        this.openModal('add', info);  // Simplified back to original
                    }
                });
            }
        } else {
            this.openModal('add', info);  // Simplified back to original
        }
    },

    handleEventClick: function (info) {
        const resource = info.event.getResources()[0];

        if (info.event.display === 'background') {
            Swal.fire({
                title: `Unavailability: ${info.event.title}`,
                text: ``,
                icon: "warning"
            });
            return;
        }

        const clickedDate = new Date(info.event.start);
        // clickedDate.setHours(12, 0, 0, 0);

        const conflict = this.checkAvailability(
            info.event.getResources()[0].id,
            clickedDate
        );

        if (conflict) {
            if (conflict.type === 'suspension_conflict') {
                Swal.fire({
                    title: "Cannot Edit Schedule",
                    text: "Employee is suspended during this period",
                    icon: "error"
                });
                return;
            } else if (conflict.type === 'shift_conflict') {
                this.renderPositionOptions(resource, "edit", info.event);
                this.openModal('edit', info);
                return;
            } else {
                Swal.fire({
                    title: `Cannot edit: Employee is ${conflict.title}`,
                    text: `START: ${conflict.start} \n END: ${conflict.end}`,
                    icon: "warning"
                });
                return;
            }
        }
    },

    // Update handleEventDrop to handle suspensions
    handleEventDrop: async function (info) {

        // Check if the resource (employee) has changed
        // console.log('info.oldResource',info.oldResource);
        // console.log('info.newResource',info.newResource);
        // console.log('info.oldResource.id',info.oldResource.id);
        // console.log('info.newResource.id',info.newResource.id);
        if (info.oldResource && info.newResource && info.oldResource._resource.id !== info.newResource._resource.id) {
            info.revert();
            await Swal.fire({
                title: 'Invalid Move',
                text: 'Shifts cannot be moved between employees.',
                icon: 'error'
            });
            return;
        }

        const conflict = this.checkAvailability(
            info.event.getResources()[0].id,
            info.event.start
        );

        if (conflict) {
            if (conflict.type === 'suspension_conflict' || conflict.type === 'shift_conflict') {
                const message = conflict.type === 'suspension_conflict'
                    ? "Employee is suspended during this period"
                    : "Employee already has a shift scheduled for this day";

                await Swal.fire({
                    title: "Cannot Move Schedule",
                    text: message,
                    icon: "error"
                });
                info.revert();
                return;
            }

            const result = await Swal.fire({
                icon: "warning",
                title: "The employee is unavailable at this date.",
                text: "Are you sure you want to add a schedule?",
                showCancelButton: true,
                confirmButtonText: "Yes",
                cancelButtonText: "No"
            });

            if (!result.isConfirmed) {
                info.revert();
                return;
            }
        }

        try {
            await this.eventDropUpdate(info.event);
        } catch (error) {
            console.error('Error updating event:', error);
            info.revert();
            await Swal.fire({
                title: 'Error',
                text: 'Failed to update schedule. Please try again.',
                icon: 'error'
            });
        }
    },

    checkAvailability: function (resourceId, date) {
        const checkDate = new Date(date);
        const checkDateStr = checkDate.toISOString().split('T')[0];
        console.log('checkDateStr', checkDateStr)

        // First check if there's already a shift scheduled (preventing multiple shifts)
        const existingShift = this.shifts.find(shift => {
            const shiftDate = new Date(shift.start);
            const shiftDateStr = shiftDate.toISOString().split('T')[0];

            if (shift.resourceId === resourceId) console.log('shiftDateStr', shiftDateStr);
            return shift.resourceId === resourceId && shiftDateStr === checkDateStr;
        });

        // If there's already a shift, return a special conflict message
        if (existingShift) {
            return {
                title: "Already Scheduled",
                start: new Date(existingShift.start).toLocaleDateString(),
                end: new Date(existingShift.start).toLocaleDateString(),
                type: 'shift_conflict'
            };
        }

        // Then check for availability conflicts
        const availabilityConflict = this.availability.find(a => {
            try {
                const startDate = new Date(a.start);
                const startDateStr = startDate.toISOString().split('T')[0];

                // Create end date and subtract one day to account for the UI adjustment
                const endDate = new Date(a.end);
                endDate.setDate(endDate.getDate() - 1);
                const endDateStr = endDate.toISOString().split('T')[0];

                // Simple string comparison of dates
                return a.resourceId === resourceId &&
                    checkDateStr >= startDateStr &&
                    checkDateStr <= endDateStr;
            } catch (error) {
                console.error('Error checking availability:', error);
                return false; // Fail safe in case of date parsing errors
            }
        });

        // If there's no availability conflict, employee is available
        if (!availabilityConflict) {
            return null;
        }

        // Return conflict with special handling for suspensions
        return {
            ...availabilityConflict,
            start: new Date(availabilityConflict.start).toLocaleDateString(),
            end: new Date(new Date(availabilityConflict.end).setDate(
                new Date(availabilityConflict.end).getDate() - 1
            )).toLocaleDateString(),
            type: availabilityConflict.title === 'Suspension' ? 'suspension_conflict' : 'availability_conflict'
        };
    },

    initializeModalHandlers: function () {
        const modal = document.getElementById('hunkpro-shift-modal');
        const closeBtn = modal.querySelector('.hunkpro-close');
        const form = document.getElementById('hunkpro-shift-form');
        const formLoader = document.getElementById('form-loader');
        const formOptions = document.getElementById('form-options');

        // Initialize Bootstrap modal
        const bsModal = new bootstrap.Modal(modal);

        formLoader.style.display = 'none';
        formLoader.classList.add('chhj-hide');
        formOptions.style.display = 'flex';
        formOptions.classList.remove('chhj-hide');

        // Close button handler
        closeBtn.onclick = () => {
            this.clearError();
            this.toggleLoader(false);
            bsModal.hide();
        };

        // Form submit handler
        form.onsubmit = (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        };

        // Handle modal hidden event
        modal.addEventListener('hidden.bs.modal', () => {
            this.clearError();
            this.toggleLoader(false);
            this.clearAllOverrides();

            // Clear all tag selections
            const tagElements = modal.querySelectorAll('.tag-item');
            tagElements.forEach(tag => tag.classList.remove('selected'));

            // Clear notes
            const notesField = document.getElementById('hunkpro-shift-notes');
            if (notesField) notesField.value = '';

            if (this.datePicker) {
                this.datePicker.destroy();
                this.datePicker = null;
            }
        });

        // Handle click outside modal
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.clearError();
                this.toggleLoader(false);
                bsModal.hide();
            }
        });

        // Add tag click handlers
        const setupTagHandlers = () => {
            const tagContainers = modal.querySelectorAll('.tags-container');
            tagContainers.forEach(container => {
                // container.addEventListener('click', (e) => {
                //     const tagItem = e.target.closest('.tag-item');
                //     if (tagItem) {
                //         tagItem.classList.toggle('selected');
                //         e.stopPropagation();
                //     }
                // });
            });
        };

        setupTagHandlers();
        return bsModal;
    },

    populateTags: function (resource, mode, event = null) {
        const containers = {
            'Tier': document.getElementById('tier-tags-container'),
            'Resource': document.getElementById('resource-tags-container')
        };

        // Clear existing tags
        Object.values(containers).forEach(container => container.innerHTML = '');

        // Determine which tags to show based on mode
        const tagsToShow = mode === 'edit' && event?.extendedProps?.tags
            ? event.extendedProps.tags
            : (resource.extendedProps.tags || []);

        // Group and filter tags by type
        this.tagsTableData
            .filter(tag => tagsToShow.some(t =>
                (typeof t === 'object' ? t.id : t) === tag.id))
            .forEach(tag => {
                const container = containers[tag.field_63];
                if (container) {
                    container.appendChild(this.createTagElement({
                        id: tag.id,
                        field_43: tag.field_43
                    },
                        tag.field_63.toLowerCase(),
                        mode === 'edit' && event?.extendedProps?.tags));
                }
            });
    },

    createTagElement: function (tag, type) {
        const tagDiv = document.createElement('div');
        tagDiv.className = 'tag-item';
        tagDiv.dataset.tagId = tag.id;
        tagDiv.dataset.tagType = type;

        // Set custom properties based on tag type using CHHJ colors
        if (type === 'tier') {
            tagDiv.style.setProperty('--tag-bg', 'var(--chhj-green-light)');
            tagDiv.style.setProperty('--tag-border', 'var(--chhj-green-border)');
            tagDiv.style.setProperty('--tag-text', 'var(--chhj-green)');
        } else if (type === 'resource') {
            tagDiv.style.setProperty('--tag-bg', 'var(--chhj-orange-light)');
            tagDiv.style.setProperty('--tag-border', 'var(--chhj-orange-border)');
            tagDiv.style.setProperty('--tag-text', 'var(--chhj-orange)');
        }

        tagDiv.innerHTML = `
${tag.field_43}
<span class="tag-remove material-icons" style="font-size: 18px;">close</span>
`;

        // Only add click handler to the remove button
        tagDiv.querySelector('.tag-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            tagDiv.remove();
        });

        return tagDiv;
    },

    // Update getSelectedTags to handle static tags
    getSelectedTags: function () {
        const modal = document.getElementById('hunkpro-shift-modal');
        const allTags = Array.from(modal.querySelectorAll('.tag-item'))
            .map(tag => ({
                id: tag.dataset.tagId,
                type: tag.dataset.tagType
            }));

        return allTags;
    },

    renderPositionOptions: function (resource, mode, event) {
        if (event != null) {
            console.log('renderPositionOptions Event :', event);
            console.log('renderPositionOptions Event position :', event?.extendedProps?.positionId?.[0]);
        }
        let positions = resource?._resource?.extendedProps?.position || [];
        console.log('positions', positions);

        var select = $('#hunkpro-shift-position');
        select.empty();

        // Add "Select Position" option only if there are multiple positions
        if (positions.length > 1) {
            select.append($('<option>', {
                value: '',
                text: 'Select Position'
            }));
        }

        positions.forEach((position) => {
            const optionElement = $('<option>', {
                value: position.id,
                text: position.val
            });
            select.append(optionElement);
        });

        console.log('options.length', positions.length);

        // Auto-select if there's only one position
        if (mode === 'add' && positions.length === 1) {
            $('#hunkpro-shift-position').val(positions[0].id).change();
        } else if (mode === 'edit' && event) {
            let positionId = event?.extendedProps?.positionId?.[0];
            const select = $('#hunkpro-shift-position');

            // Clear current selection
            select.prop('selectedIndex', -1);
            // Set the value
            select.val(positionId);
            select.prop('selected', true);

            // Log for debugging
            console.log('Position options:', select.find('option').length);
            console.log('Selected value:', select.val());
        }
    },

    openModal: function (mode, info) {
        const modal = document.getElementById('hunkpro-shift-modal');
        const modalTitle = document.getElementById('hunkpro-modal-title');
        const dateInput = document.getElementById('hunkpro-shift-date');
        const employeeInput = document.getElementById('hunkpro-shift-employee');
        const positionSelect = document.getElementById('hunkpro-shift-position');
        const notesInput = document.getElementById('hunkpro-shift-notes');

        this.toggleLoader(false);
        this.clearError();

        modalTitle.textContent = mode === 'add' ? 'Add Shift' : 'Edit Shift';

        // Set modal data attributes
        modal.dataset.mode = mode;
        modal.dataset.resourceId = mode === 'add' ? info.resource.id : info.event.getResources()[0].id;
        modal.dataset.start = mode === 'add' ? info.startStr : info.event.startStr;

        if (mode === 'edit') {
            modal.dataset.eventId = info.event.id;
            const eventDate = new Date(info.event.start);
            this.addOverrideDate(info.event.getResources()[0].id, eventDate);
        }

        // Initialize date picker
        this.initializeDatePicker();

        // Set form values
        if (mode === 'add') {
            this.datePicker.setDate(info.start);
            employeeInput.value = info.resource.title;
            positionSelect.value = '';
            this.renderPositionOptions(info.resource, mode, null);
            notesInput.value = ''; // Clear notes for new shifts
        } else {
            this.datePicker.setDate(info.event.start);
            employeeInput.value = info.event.getResources()[0].title;
            positionSelect.value = info.event.title.toLowerCase();
            this.renderPositionOptions(info.event.getResources()[0], mode, info.event);
            notesInput.value = info.event.extendedProps.notes || '';
        }

        // Populate tags based on the resource
        // this.populateTags(mode === 'add' ? info.resource : info.event.getResources()[0]);

        // Populate tags based on the mode and available data
        if (mode === 'add') {
            this.populateTags(info.resource, mode);
        } else {
            this.populateTags(info.event.getResources()[0], mode, info.event);
        }

        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();


    },

    // Generate a unique operation ID
    generateOperationId: function () {
        return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },

    // Track an operation and its associated event
    trackOperation: function (operationId, event, type) {
        this.pendingOperations.set(operationId, {
            event,
            type,
            status: 'pending',
            timestamp: Date.now()
        });
    },

    // Update handleFormSubmit with improved event tracking
    handleFormSubmit: async function () {
        const modal = document.getElementById('hunkpro-shift-modal');
        const position = document.getElementById('hunkpro-shift-position').value;
        const notesInput = document.getElementById('hunkpro-shift-notes').value;
        const isAddMode = modal.dataset.mode === 'add';

        const selectedTags = this.getSelectedTags();
        const tagIds = selectedTags.map(tag => tag.id);

        this.clearError();

        if (!position || position.trim() === '') {
            this.showError('Please select a position before continuing');
            return;
        }

        // Generate unique operation ID
        const operationId = this.generateOperationId();

        try {
            this.toggleLoader(true, isAddMode ? 'Adding Shift...' : 'Updating Shift...');

            const positionDisplayText = $('#hunkpro-shift-position option:selected').text();
            const selectedDate = this.datePicker.formatDate(
                this.datePicker.selectedDates[0],
                "Y-m-d"
            );

            // Get existing event's publish status
            const getPublishStatus = () => {
                if (isAddMode) return 'Not Published';
                const event = this.calendar.getEventById(modal.dataset.eventId);
                return event?.extendedProps?.publishStatus === 'Published' ? 'Re-Publish' : 'Not Published';
            };

            // Create event data
            const eventData = {
                id: operationId,
                resourceId: modal.dataset.resourceId,
                title: positionDisplayText,
                start: selectedDate,
                allDay: true,
                classNames: [`hunkpro-shift-${positionDisplayText.toLowerCase().replace(/\s+/g, '')}`],
                extendedProps: {
                    publishStatus: getPublishStatus(),
                    hasNotes: notesInput.trim().length > 0,
                    notes: notesInput,
                    tags: tagIds,
                    tags2: selectedTags,
                    syncStatus: 'syncing',
                    positionId: [position],
                    operationId
                }
            };

            let calendarEvent;

            // Add or update the calendar event first
            if (isAddMode) {
                calendarEvent = this.calendar.addEvent(eventData);
                this.trackOperation(operationId, calendarEvent, 'add');
            } else {
                const existingEvent = this.calendar.getEventById(modal.dataset.eventId);
                console.log('existingEvent', existingEvent);
                console.log('existingEvent typeof', typeof existingEvent);
                if (existingEvent) {
                    this.trackOperation(operationId, existingEvent, 'update');

                    // Update event properties
                    existingEvent.setProp('title', eventData.title);
                    existingEvent.setProp('start', eventData.start);
                    existingEvent.setProp('allDay', true);

                    if (existingEvent._def) {
                        existingEvent._def.classNames = eventData.classNames;
                    }

                    Object.keys(eventData.extendedProps).forEach(key => {
                        existingEvent.setExtendedProp(key, eventData.extendedProps[key]);
                    });

                    calendarEvent = existingEvent;
                }
            }

            // Close modal before API call
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();

            // Make API call based on mode
            if (isAddMode) {
                const response = await this.addShift({
                    operationId,
                    user: modal.dataset.resourceId,
                    position: position,
                    date: selectedDate,
                    tags: tagIds,
                    notes: notesInput
                });

                console.log('isAddMode shift response:', response);

                // Fetch fresh shift data and add to calendar
                const freshShiftData = await this.fetchScheduleById(response.id);

                // Update operation status
                this.pendingOperations.get(operationId).status = 'success';

                // Add to local shifts array
                this.shifts.push(freshShiftData);

                // Remove temporary event
                if (calendarEvent && !calendarEvent.isDeleted) {
                    calendarEvent.remove();
                }

                // Add to calendar with complete data
                this.calendar.addEvent(freshShiftData);



            } else {

                const response = await this.updateShift({
                    operationId,
                    id: modal.dataset.eventId,
                    date: selectedDate,
                    position: position,
                    tags: tagIds,
                    notes: notesInput,
                    publishStatus: eventData.extendedProps.publishStatus
                });

                console.log('Update shift response:', response);

                // Fetch fresh shift data after update
                const freshShiftData = await this.fetchScheduleById(modal.dataset.eventId);

                // Update operation status
                this.pendingOperations.get(operationId).status = 'success';

                // Update the shift in the local shifts array
                const shiftIndex = this.shifts.findIndex(s => s.id === modal.dataset.eventId);
                if (shiftIndex !== -1) {
                    this.shifts[shiftIndex] = freshShiftData;
                }

                if (calendarEvent && !calendarEvent.isDeleted) {
                    // Remove the existing event
                    calendarEvent.remove();

                    // Add the updated event with fresh data
                    this.calendar.addEvent(freshShiftData);

                    //     // Update existing event with final data
                    //     Object.keys(eventData.extendedProps).forEach(key => {
                    //         if (key !== 'syncStatus' && key !== 'operationId') {
                    //             calendarEvent.setExtendedProp(key, eventData.extendedProps[key]);
                    //         }
                    //     });
                    //     calendarEvent.setExtendedProp('syncStatus', null);
                }
            }

            // Update counts after successful operation
            this.updateAllCounts();

        } catch (error) {
            console.error('Error handling form submit:', error);

            // Find event by operation ID
            const operation = this.pendingOperations.get(operationId);
            if (operation && operation.event && !operation.event.isDeleted) {
                operation.event.setExtendedProp('syncStatus', 'error');

                // Handle cleanup after error display
                setTimeout(() => {
                    if (isAddMode) {
                        operation.event.remove();
                    } else if (operation.event && !operation.event.isDeleted) {
                        operation.event.setExtendedProp('syncStatus', null);
                    }
                }, 3000);
            }

            this.toggleLoader(false);
            this.showError('Failed to save shift. Please try again.');

        } finally {
            // Cleanup operation after delay
            setTimeout(() => {
                this.pendingOperations.delete(operationId);
            }, 5000);

            this.clearAllOverrides();
        }
    },

    toggleLoader: function (show, message = '') {
        const formOptions = document.getElementById('form-options');
        const formLoader = document.getElementById('form-loader');
        const loaderMessage = formLoader.querySelector('.loader-message');

        if (show) {
            formOptions.style.display = 'flex';
            formLoader.style.display = 'flex';
            formLoader.classList.remove('chhj-hide');
            formOptions.classList.add('chhj-hide');
            loaderMessage.textContent = message;
        } else {
            formLoader.style.display = 'none';
            formOptions.style.display = 'flex';
            formLoader.classList.add('chhj-hide');
            formOptions.classList.remove('chhj-hide');
        }
    },

    showError: function (message) {
        const errorDiv = document.getElementById('form-error');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    },

    clearError: function () {
        const errorDiv = document.getElementById('form-error');
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
    },

    eventDropUpdate: async function (event) {
        // Generate unique operation ID
        const operationId = this.generateOperationId();
        console.log('event', event);
        console.log('event typeof', typeof event);

        try {
            // Get current publish status from event
            let publishStatus = event.extendedProps.publishStatus || 'Not Published';
            // if currently published, make sure to tag as Re-Publish
            publishStatus = publishStatus === 'Published' ? 'Re-Publish' : publishStatus;

            // Track the operation
            this.trackOperation(operationId, event, 'update');

            // Set sync status to 'syncing' and update the event display
            event.setExtendedProp('syncStatus', 'syncing');
            event.setExtendedProp('operationId', operationId);

            // Force immediate re-render of the event
            // event.remove(); // Remove the event
            // this.calendar.addEvent(event); // Re-add the event to trigger a re-render

            // Update the shift
            await this.updateShift({
                operationId,
                id: event.id,
                date: event.startStr,
                position: event.extendedProps?.positionId?.[0] || '',
                publishStatus
            });

            // Fetch fresh shift data after update
            const freshShiftData = await this.fetchScheduleById(event.id);

            // Update operation status
            this.pendingOperations.get(operationId).status = 'success';

            // Update the shift in the local shifts array
            const shiftIndex = this.shifts.findIndex(s => s.id === event.id);
            if (shiftIndex !== -1) {
                this.shifts[shiftIndex] = freshShiftData;
            } else {
                // If not found, add it to the array
                this.shifts.push(freshShiftData);
            }

            // Remove the existing event from the calendar
            event.remove();

            // Add the updated event with fresh data to the calendar
            this.calendar.addEvent(freshShiftData);

            // Update all counts
            this.updateAllCounts();

        } catch (error) {
            console.error('Error updating dropped event:', error);

            // Find event by operation ID
            const operation = this.pendingOperations.get(operationId);
            if (operation && operation.event && !operation.event.isDeleted) {
                operation.event.setExtendedProp('syncStatus', 'error');
                operation.event.setExtendedProp('operationId', null);

                // Force re-render of the event
                operation.event.remove();
                this.calendar.addEvent(operation.event);

                // Revert the drop
                operation.event.revert();

                // Handle cleanup after error display
                setTimeout(() => {
                    if (operation.event && !operation.event.isDeleted) {
                        operation.event.setExtendedProp('syncStatus', null);
                        operation.event.setExtendedProp('operationId', null);

                        // Force another re-render
                        operation.event.remove();
                        this.calendar.addEvent(operation.event);
                    }
                }, 3000);
            }

            await Swal.fire({
                title: 'Error',
                text: 'Failed to update shift. The change has been reverted.',
                icon: 'error'
            });

        } finally {
            // Cleanup operation after delay
            setTimeout(() => {
                this.pendingOperations.delete(operationId);
            }, 5000);
        }
    },

    getWeeklyShiftCount: function (resourceId) {
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        return this.shifts.filter(shift =>
            shift.resourceId === resourceId &&
            new Date(shift.start) >= viewStart &&
            new Date(shift.start) < viewEnd
        ).length;
    },


    getDailyShiftCount: function (date) {
        const normalizedTargetDate = new Date(date);
        // normalizedTargetDate.setHours(0, 0, 0, 0);

        return this.shifts.filter(shift => {
            const shiftDate = new Date(shift.start);
            // shiftDate.setHours(0, 0, 0, 0);
            return shiftDate.getTime() === normalizedTargetDate.getTime();
        }).length;
    },

    updateAllCounts: function () {
        // Ensure calendar is rendered before updating counts
        if (!this.calendar.isRendered) {
            return;
        }

        // Get current view dates
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // Process tag statistics for each day in the view
        for (let date = new Date(viewStart); date < viewEnd; date.setDate(date.getDate() + 1)) {
            this.processTagStatistics(date);
            // console.log(`Tag Statistics ${date} ::: `, this.tagStatistics);
        }

        const unpublishedCount = this.countUnpublishedShifts();
        this.updatePublishButton(unpublishedCount);

        // Update resource shift counts
        this.calendar.getResources().forEach(resource => {
            const weeklyShifts = this.getWeeklyShiftCount(resource.id);
            resource.setExtendedProp('weeklyShifts', weeklyShifts);

            const resourceEl = this.calendar.el.querySelector(`[data-resource-id="${resource.id}"]`);
            if (resourceEl) {
                const totalShiftsEl = resourceEl.querySelector('.hunkpro-shift-count');
                if (totalShiftsEl) {
                    totalShiftsEl.textContent = `${weeklyShifts} Shifts`;
                }
            }
        });

        // Update day header counts with improved date handling
        const counts = this.getDailyShiftCounts();
        Object.entries(counts).forEach(([dateStr, count]) => {
            // Find header element for this date
            const headerEl = this.calendar.el.querySelector(`[data-date="${dateStr}"]`);
            if (headerEl) {
                let countEl = headerEl.querySelector('.hunkpro-header-count');
                if (!countEl) {
                    countEl = document.createElement('div');
                    countEl.className = 'hunkpro-header-count';
                    headerEl.appendChild(countEl);
                }
                // Always update the count display
                countEl.textContent = `(${count})`;
            }
        });

        // Force a rerender of the calendar to ensure all counts are displayed
        this.calendar.render();
    },
    initializeDatePicker: function () {
        const dateInput = document.getElementById('hunkpro-shift-date');
        const modal = document.getElementById('hunkpro-shift-modal');
        const isEditMode = modal.dataset.mode === 'edit';
        const currentEventId = isEditMode ? modal.dataset.eventId : null;

        // Get current view's start and end dates from FullCalendar
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // Ensure clean slate
        if (this.datePicker) {
            this.datePicker.destroy();
        }

        this.datePicker = flatpickr(dateInput, {
            dateFormat: "Y-m-d",
            defaultDate: "today",
            locale: {
                firstDayOfWeek: 1
            },
            // Enable date selection only within the current view's date range
            minDate: viewStart,
            maxDate: new Date(viewEnd.getTime() - 24 * 60 * 60 * 1000), // Subtract one day from end date

            // Disable dates outside the current week and handle availability conflicts
            disable: [
                (date) => {
                    const resourceId = modal.dataset.resourceId;

                    if (!resourceId) {
                        console.log('No resource ID available');
                        return false;
                    }

                    const checkDate = new Date(date);
                    const checkDateStr = checkDate.toISOString().split('T')[0];

                    // Check if date is within current view range
                    // Normalize view dates for comparison
                    const viewStartStr = new Date(viewStart).toISOString().split('T')[0];
                    const viewEndStr = new Date(viewEnd).toISOString().split('T')[0];

                    if (checkDateStr < viewStartStr || checkDateStr >= viewEndStr) {
                        return true;
                    }

                    // Check for shifts on this date using normalized date comparison
                    const existingShift = this.shifts.find(shift => {
                        const shiftDate = new Date(shift.start);
                        const shiftDateStr = shiftDate.toISOString().split('T')[0];

                        return shift.resourceId === resourceId &&
                            shiftDateStr === checkDateStr &&
                            shift.id !== currentEventId; // Don't block current shift in edit mode
                    });

                    // If there's a shift and we're not editing that specific shift, disable the date
                    if (existingShift) {
                        return true;
                    }

                    // Check if date is overridden (from previous availability override)
                    if (this.isDateOverridden(resourceId, checkDate)) {
                        return false;
                    }

                    // Check for availability conflicts using normalized dates
                    const availabilityConflict = this.availability.some(avail => {
                        if (avail.resourceId !== resourceId) return false;

                        try {
                            const startDate = new Date(avail.start);
                            const startDateStr = startDate.toISOString().split('T')[0];

                            // Create end date and subtract one day to account for the UI adjustment
                            const endDate = new Date(avail.end);
                            endDate.setDate(endDate.getDate() - 1);
                            const endDateStr = endDate.toISOString().split('T')[0];

                            // Simple string comparison of dates
                            return checkDateStr >= startDateStr &&
                                checkDateStr <= endDateStr;
                        } catch (error) {
                            console.error('Error checking availability in date picker:', error, avail);
                            return false;
                        }
                    });

                    return availabilityConflict;
                }
            ],

            // Show the calendar immediately when the input is focused
            allowInput: false,
            clickOpens: true,

            // Update the calendar when it opens to ensure correct date range
            onOpen: function (selectedDates, dateStr, instance) {
                // Force update of the calendar to ensure correct date range
                instance.jumpToDate(instance.selectedDates[0] || viewStart);
            },

            onChange: (selectedDates, dateStr) => {
                // Log selected date for debugging
                console.log('Selected date:', dateStr);
                console.log('Normalized date:', new Date(dateStr).toISOString().split('T')[0]);
            },

            onClose: () => {
                const resourceId = modal.dataset.resourceId;
                if (resourceId) {
                    // Additional cleanup logic if needed
                }
            }
        });

        return this.datePicker;
    },
    // Add override for specific employee and date
    addOverrideDate: function (employeeId, date) {
        const dateStr = new Date(date).toISOString().split('T')[0];
        if (!this.overrideDates.has(employeeId)) {
            this.overrideDates.set(employeeId, new Set());
        }
        this.overrideDates.get(employeeId).add(dateStr);
    },

    // Remove override for specific employee and date
    removeOverrideDate: function (employeeId, date) {
        const dateStr = new Date(date).toISOString().split('T')[0];
        if (this.overrideDates.has(employeeId)) {
            this.overrideDates.get(employeeId).delete(dateStr);
            // Clean up empty sets
            if (this.overrideDates.get(employeeId).size === 0) {
                this.overrideDates.delete(employeeId);
            }
        }
    },
    // Check if date is overridden for employee
    isDateOverridden: function (employeeId, date) {
        // console.log('overrideDates',this.overrideDates);
        const dateStr = new Date(date).toISOString().split('T')[0];
        return this.overrideDates.has(employeeId) &&
            this.overrideDates.get(employeeId).has(dateStr);
    },

    // Clear all overrides for an employee
    clearEmployeeOverrides: function (employeeId) {
        this.overrideDates.delete(employeeId);
    },

    // Clear all overrides
    clearAllOverrides: function () {
        this.overrideDates.clear();
    },

    updateRefreshButtonState: function (isRefreshing) {
        const button = this.calendar.el.querySelector('.fc-refresh-button');
        if (!button) return;

        const buttonContainer = button.parentNode;

        if (isRefreshing) {
            // Hide button and show loader - reusing existing loader structure
            button.style.display = 'none';
            if (!buttonContainer.querySelector('.refresh-loader-container')) {
                const loader = document.createElement('div');
                loader.className = 'refresh-loader-container';
                loader.innerHTML = '<div class="chhj-loader chhj-loader-segment"></div>';
                buttonContainer.appendChild(loader);
            }
        } else {
            // Remove loader and show button
            const loader = buttonContainer.querySelector('.refresh-loader-container');
            if (loader) {
                buttonContainer.removeChild(loader);
            }
            button.style.display = '';
        }
    },

};

// Initialize the scheduler
document.addEventListener('DOMContentLoaded', function () {
    window.HunkProScheduler.init();
});