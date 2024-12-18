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
                // console.log(`Using cached data for ${cacheKey}`);
                return processData(cachedData);
            }

            // If no valid cache, make API call
            const data = await this.makeApiCallWithRetry(apiCall);
            const processedData = processData(data);
            this.updateCache(cacheKey, processedData);
            // console.log(`Fetched fresh data for ${cacheKey}`);
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

const DateUtility = {

    // Get Today in UTC
    getToday: function () {
        return new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate()
        ));
    },

    debugDate: function (label, date) {
        console.group(`Debug Date: ${label}`);
        try {
            if (!date) {
                console.log('Date is null/undefined');
                console.groupEnd();
                return;
            }

            const d = date instanceof Date ? date : new Date(date);
            console.log('Input:', date);
            console.log('As Date object:', d);
            console.log('UTC ISO:', d.toISOString());
            console.log('UTC String:', d.toUTCString());
            console.log('UTC Components:', {
                year: d.getUTCFullYear(),
                month: d.getUTCMonth() + 1,
                day: d.getUTCDate()
            });
            console.log('Local Components:', {
                year: d.getFullYear(),
                month: d.getMonth() + 1,
                day: d.getDate()
            });
        } catch (error) {
            console.error('Error debugging date:', error);
        }
        console.groupEnd();
    },

    // Basic validation helper
    isValidDate: function (date) {
        if (!date) return false;
        const d = new Date(date);
        return d instanceof Date && !isNaN(d);
    },

    // Get start of day in UTC (00:00:00.000)
    startOfDay: function (date) {
        try {
            // Handle null/undefined
            if (!date) {
                throw new Error('No date provided');
            }

            // If it's already a Date object, validate and convert to UTC
            if (date instanceof Date) {
                if (isNaN(date.getTime())) {
                    throw new Error('Invalid Date object');
                }
                return new Date(Date.UTC(
                    date.getUTCFullYear(),
                    date.getUTCMonth(),
                    date.getUTCDate(),
                    0, 0, 0, 0
                ));
            }

            // If it's a string, ensure it's a valid ISO date format
            if (typeof date === 'string') {
                // First try parsing as ISO string
                const [datePart] = date.split('T');
                const [year, month, day] = datePart.split('-').map(Number);

                if (!year || !month || !day ||
                    isNaN(year) || isNaN(month) || isNaN(day)) {
                    throw new Error('Invalid date string format');
                }

                return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
            }

            throw new Error(`Unsupported date type: ${typeof date}`);
        } catch (error) {
            console.error('startOfDay error:', error.message, 'for input:', date);
            // Instead of throwing, return null to allow graceful handling
            return null;
        }
    },
    // Get end of day in UTC (23:59:59.999)
    endOfDay: function (date) {
        if (!this.isValidDate(date)) {
            throw new Error('Invalid date provided to endOfDay');
        }
        // If date is a string, parse it directly to UTC
        if (typeof date === 'string') {
            const [year, month, day] = date.split('-').map(Number);
            return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        }
        // If date is already a Date object, use its UTC components
        return new Date(Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            23, 59, 59, 999
        ));
    },

    // Format date to YYYY-MM-DD
    formatDate: function (date) {
        if (!this.isValidDate(date)) {
            throw new Error('Invalid date provided to formatDate');
        }
        return this.startOfDay(date).toISOString().split('T')[0];
    },

    // Format date range for display
    formatDateRange: function (startDate, endDate) {
        return `${this.formatDate(startDate)} to ${this.formatDate(endDate)}`;
    },

    // Compare two dates (ignoring time)
    isSameDate: function (date1, date2) {
        return this.formatDate(date1) === this.formatDate(date2);
    },

    // Check if a date falls within a range (inclusive)
    isDateInRange: function (date, startDate, endDate) {
        const d = this.startOfDay(date);
        const start = this.startOfDay(startDate);
        const end = this.endOfDay(endDate);

        // If any date is invalid, return false
        if (!d || !start || !end) {
            return false;
        }

        return d >= start && d <= end;
    },

    // Add days with validation
    addDays: function (date, days) {
        // Validate inputs
        if (typeof days !== 'number') {
            console.warn('Invalid days parameter:', days);
            return null;
        }

        const utcDate = this.startOfDay(date);
        if (!utcDate) {
            console.warn('Invalid date in addDays:', date);
            return null;
        }

        utcDate.setUTCDate(utcDate.getUTCDate() + days);
        return utcDate;
    },

    subtractDays: function (date, days) {
        return this.addDays(date, -Math.abs(days));
    },
    // Get complete view date info
    getViewDateInfo: function (currentView) {
        if (!currentView?.activeStart || !currentView?.activeEnd) {
            throw new Error('Invalid view provided to getViewDateInfo');
        }

        const viewStart = this.startOfDay(currentView.activeStart);
        const viewEnd = this.endOfDay(currentView.activeEnd);
        const adjustedEnd = this.endOfDay(this.subtractDays(currentView.activeEnd, 1));

        // console.group('getViewDateInfo');
        // console.log('currentView?.activeStart',currentView?.activeStart);
        // console.log('currentView?.activeEnd',currentView?.activeEnd);
        // console.log('viewStart',viewStart);
        // console.log('viewEnd',viewEnd);
        // console.log('adjustedEnd',adjustedEnd);
        // console.groupEnd();

        return {
            today: this.formatDate(this.getToday()),
            start: viewStart,
            end: viewEnd,
            adjustedEnd: adjustedEnd,
            startStr: this.formatDate(viewStart),
            endStr: this.formatDate(adjustedEnd),
            isWithinView: (date) => this.isDateInRange(date, viewStart, adjustedEnd),
            daysInView: Math.round((adjustedEnd - viewStart) / (1000 * 60 * 60 * 24)) + 1
        };
    },

    // Get week boundaries
    getWeekBoundaries: function (date) {
        const d = this.startOfDay(date);
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
        const sunday = this.addDays(monday, 6);

        return {
            start: monday,
            end: sunday,
            startStr: this.formatDate(monday),
            endStr: this.formatDate(sunday)
        };
    },

    // Parse shift date consistently
    parseShiftDate: function (shiftDateStr) {
        if (!shiftDateStr) return null;
        return this.startOfDay(shiftDateStr);
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
    modalFormData: new WeakMap(),

    countUnpublishedShifts: function () {
        const currentView = this.calendar.view;
        const dateInfo = DateUtility.getViewDateInfo(currentView);
        const { start: viewStart, adjustedEnd: adjustedEndDate } = dateInfo;

        // Initialize counters
        const counts = {
            notPublished: 0,
            rePublish: 0,
            total: 0
        };

        // Filter shifts within current view
        this.shifts.forEach(shift => {
            const shiftDate = DateUtility.parseShiftDate(shift.start);
            if (dateInfo.isWithinView(shiftDate)) {
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

        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
        dateRange.textContent = DateUtility.formatDateRange(dateInfo.start, dateInfo.adjustedEnd);
        console.log('showPublishDialog ::: dateInfo', dateInfo);

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
            const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
            console.log('handlePublishConfirm ::: dateInfo', dateInfo);

            // Get all unpublished shifts in current view
            const shiftsToPublish = this.shifts.filter(shift => {
                const shiftDate = DateUtility.parseShiftDate(shift.start);
                return DateUtility.isDateInRange(shiftDate, dateInfo.start, dateInfo.adjustedEnd) &&
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
        // Ensure we have a valid date to process
        const processDate = DateUtility.parseShiftDate(date);
        if (!processDate) {
            console.error('Invalid date provided to processTagStatistics:', date);
            return;
        }

        const dateStr = DateUtility.formatDate(processDate);

        // Initialize statistics structure for this date if it doesn't exist
        if (!this.tagStatistics[dateStr]) {
            this.tagStatistics[dateStr] = {
                serviceCategories: {},
                tagCategories: {}
            };
        }

        // Get all shifts for this date using DateUtility for comparison
        const shiftsForDate = this.shifts.filter(shift => {
            const shiftDate = DateUtility.parseShiftDate(shift.start);
            return shiftDate && DateUtility.formatDate(shiftDate) === dateStr;
        });

        // Reset counts for this date
        this.tagStatistics[dateStr] = {
            serviceCategories: {},
            tagCategories: {}
        };

        // Process each shift's tags
        shiftsForDate.forEach(shift => {
            if (!shift.extendedProps?.tags2) return;

            shift.extendedProps.tags2.forEach(tag => {
                // Find the full tag data
                const tagData = this.tagsTableData.find(t => t.id === tag.id);
                if (!tagData) return;

                // Process Service Category counts
                const serviceCategory = tagData.field_70 || 'Uncategorized';
                if (!this.tagStatistics[dateStr].serviceCategories[serviceCategory]) {
                    this.tagStatistics[dateStr].serviceCategories[serviceCategory] = {
                        total: 0,
                        tags: {}
                    };
                }

                const serviceCategoryStats = this.tagStatistics[dateStr].serviceCategories[serviceCategory];
                serviceCategoryStats.total++;

                // Track individual tags within service category
                if (!serviceCategoryStats.tags[tag.val]) {
                    serviceCategoryStats.tags[tag.val] = 0;
                }
                serviceCategoryStats.tags[tag.val]++;

                // Process Tag Category counts
                const tagCategory = tagData.field_63 || 'Uncategorized';
                if (!this.tagStatistics[dateStr].tagCategories[tagCategory]) {
                    this.tagStatistics[dateStr].tagCategories[tagCategory] = {
                        total: 0,
                        tags: {}
                    };
                }

                const tagCategoryStats = this.tagStatistics[dateStr].tagCategories[tagCategory];
                tagCategoryStats.total++;

                // Track individual tags within tag category
                if (!tagCategoryStats.tags[tag.val]) {
                    tagCategoryStats.tags[tag.val] = 0;
                }
                tagCategoryStats.tags[tag.val]++;
            });
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
                    // console.log(`Employees ::: fetchPage ${page}`);
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
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
        // console.log('fetchSchedules ::: dateInfo', dateInfo);
        const startDate = dateInfo.startStr;
        const endDate = dateInfo.endStr;

        // Helper function to fetch a single page
        const fetchPage = async (page) => {
            // console.log(`Schedules ::: fetchPage ${page}`);
            return new Promise((resolve, reject) => {
                $.ajax({
                    url: `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records?filters[items][0][field_id]=field_60&filters[items][0][operator]=is%20on%20or%20after&filters[items][0][val]=${startDate}&filters[items][1][field_id]=field_60&filters[items][1][operator]=is%20on%20or%20before&filters[items][1][val]=${endDate}&limit=100&page=${page}`,
                    method: "GET",
                    timeout: 0,
                    headers: {
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
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);

        // Add buffer days
        const bufferStart = DateUtility.subtractDays(dateInfo.start, 7);
        const bufferEnd = DateUtility.addDays(dateInfo.adjustedEnd, 7);

        const startDate = DateUtility.formatDate(bufferStart);
        const endDate = DateUtility.formatDate(bufferEnd);

        const classMap = this.availabilityClassMap;

        // console.group('fetchAvailability');
        // console.log('dateInfo', dateInfo);
        // console.log('bufferStart', bufferStart);
        // console.log('bufferEnd', bufferEnd);
        // console.log('startDate', startDate);
        // console.log('endDate', endDate);
        // console.groupEnd();

        // Helper function to fetch a single page
        const fetchPage = async (page) => {
            // console.log(`Availability ::: fetchPage ${page}`);
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
                        const start = DateUtility.formatDate(item.field_428.start.split(' ')[0]);
                        // Create end date as the start of the next day after the end date
                        // This ensures the availability covers the full end date
                        const endDate = DateUtility.addDays(
                            DateUtility.parseShiftDate(item.field_428.end.split(' ')[0]),
                            1
                        );
                        const end = DateUtility.formatDate(endDate);

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
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
        const bufferStart = DateUtility.subtractDays(dateInfo.start, 7);
        const bufferEnd = DateUtility.addDays(dateInfo.end, 7);
        const startDate = DateUtility.formatDate(bufferStart);
        const endDate = DateUtility.formatDate(bufferEnd);

        const dayMapping = {
            'Sunday': 0,
            'Monday': 1,
            'Tuesday': 2,
            'Wednesday': 3,
            'Thursday': 4,
            'Friday': 5,
            'Saturday': 6
        };

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
                            const selectedDays = item.field_475
                                .filter(day => day !== "")
                                .map(day => dayMapping[day]);

                            let currentDate = dateInfo.start;
                            while (currentDate < dateInfo.end) {
                                if (selectedDays.includes(currentDate.getUTCDay())) {
                                    const hasExistingAvailability = this.availability.some(avail => {
                                        return avail.resourceId === item.field_64[0] &&
                                            DateUtility.isDateInRange(
                                                currentDate,
                                                DateUtility.parseShiftDate(avail.start),
                                                DateUtility.subtractDays(DateUtility.parseShiftDate(avail.end), 1)
                                            );
                                    });

                                    if (!hasExistingAvailability) {
                                        availability.push({
                                            id: `${item.id}-${DateUtility.formatDate(currentDate)}`,
                                            resourceId: item.field_64[0],
                                            start: `${DateUtility.formatDate(currentDate)}T00:00:00`,
                                            end: `${DateUtility.formatDate(DateUtility.addDays(currentDate, 1))}T00:00:00`,
                                            title: 'Regular Day Off',
                                            display: 'background',
                                            textColor: 'black',
                                            classNames: ['hunkpro-unavailable-regular', 'hunkpro-unavailable-text']
                                        });
                                    }
                                }
                                currentDate = DateUtility.addDays(currentDate, 1);
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
        const start = DateUtility.parseShiftDate(startDate);
        const end = DateUtility.parseShiftDate(endDate);

        if (!start || !end) {
            console.error('Invalid date range for availability events');
            return events;
        }

        let currentDate = start;
        while (currentDate <= end) {
            const dateStr = DateUtility.formatDate(currentDate);
            events.push({
                id: `${id}-${dateStr}`,
                resourceId: resourceId,
                start: dateStr,
                end: DateUtility.formatDate(DateUtility.addDays(currentDate, 1)),
                title: title,
                display: 'background',
                classNames: [className],
            });
            currentDate = DateUtility.addDays(currentDate, 1);
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
            timeZone: 'UTC',
            displayTimeZone: 'UTC',
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

        try {
            // Get current view dates using DateUtility
            const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);

            // Calculate next week dates using DateUtility
            const nextWeekStart = DateUtility.addDays(dateInfo.start, 7);
            const nextWeekEnd = DateUtility.addDays(dateInfo.adjustedEnd, 7);

            if (!nextWeekStart || !nextWeekEnd) {
                throw new Error('Failed to calculate next week dates');
            }

            // Format date display using DateUtility
            dateRange.innerHTML = `
<strong>From:</strong> ${DateUtility.formatDate(dateInfo.start)} - ${DateUtility.formatDate(dateInfo.adjustedEnd)}<br>
<strong>To:</strong> ${DateUtility.formatDate(nextWeekStart)} - ${DateUtility.formatDate(nextWeekEnd)}
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

                // Count shifts to copy using DateUtility for date comparisons
                const shiftsToCount = this.shifts.filter(shift => {
                    const shiftDate = DateUtility.parseShiftDate(shift.start);
                    return shiftDate && DateUtility.isDateInRange(
                        shiftDate,
                        dateInfo.start,
                        dateInfo.adjustedEnd
                    );
                }).length;

                // Update stats in modal
                modal.querySelector('#shiftsCount').textContent = shiftsToCount;

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

        } catch (error) {
            console.error('Error setting up copy dialog:', error);
            await Swal.fire({
                title: 'Error',
                text: 'Failed to prepare copy dialog. Please try again.',
                icon: 'error'
            });
        }
    },

    countShiftsToCopy: function () {
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);

        return this.shifts.filter(shift => {
            const shiftDate = DateUtility.parseShiftDate(shift.start);
            return shiftDate && DateUtility.isDateInRange(
                shiftDate,
                dateInfo.start,
                dateInfo.adjustedEnd
            );
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
            // Get current view dates using DateUtility
            const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);

            // Get shifts to copy using DateUtility for filtering
            const shiftsToCopy = this.shifts.filter(shift => {
                const shiftDate = DateUtility.parseShiftDate(shift.start);
                return shiftDate && DateUtility.isDateInRange(
                    shiftDate,
                    dateInfo.start,
                    dateInfo.adjustedEnd
                );
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

                    // Calculate new date (7 days later) using DateUtility
                    const shiftDate = DateUtility.parseShiftDate(shift.start);
                    if (!shiftDate) {
                        throw new Error('Invalid shift date');
                    }
                    const newDate = DateUtility.addDays(shiftDate, 7);
                    if (!newDate) {
                        throw new Error('Failed to calculate new date');
                    }

                    // Prepare form data for new shift
                    const form = new FormData();
                    form.append('field_58', shift.resourceId);
                    form.append('field_60', DateUtility.formatDate(newDate));
                    form.append('field_59', shift.positionId[0]);
                    form.append('field_478', 'Not Published');

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

                    // Calculate new date using DateUtility
                    const shiftDate = DateUtility.parseShiftDate(failedItem.shift.start);
                    if (!shiftDate) {
                        throw new Error('Invalid shift date');
                    }
                    const newDate = DateUtility.addDays(shiftDate, 7);
                    if (!newDate) {
                        throw new Error('Failed to calculate new date');
                    }

                    const form = new FormData();
                    form.append('field_58', failedItem.shift.resourceId);
                    form.append('field_60', DateUtility.formatDate(newDate));
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

    handleSelect: function (info) {
        // Validate resource exists
        if (!info.resource || !info.resource.id) {
            console.error('Invalid resource in selection');
            Swal.fire({
                title: "Error",
                text: "Invalid employee selection",
                icon: "error"
            });
            return;
        }

        // console.group('handleSelect');
        // console.log('info.start', info.startStr);
        // console.log('DateUtility.parseShiftDate(info.start)', DateUtility.parseShiftDate(info.startStr));
        // console.log('info', info);
        // console.groupEnd();
        // Parse and validate the selected date using DateUtility
        const selectedDate = DateUtility.parseShiftDate(info.startStr);
        if (!selectedDate) {
            console.error('Invalid selection date:', info.startStr);
            Swal.fire({
                title: "Error",
                text: "Invalid date selection",
                icon: "error"
            });
            return;
        }

        // Check for availability conflicts
        const conflict = this.checkAvailability(info.resource.id, selectedDate);

        // Handle different conflict scenarios
        if (conflict) {
            switch (conflict.type) {
                case 'shift_conflict':
                    Swal.fire({
                        title: "Cannot Add Schedule",
                        text: "Employee already has a shift scheduled for this day",
                        html: `Date: ${DateUtility.formatDate(selectedDate)}`,
                        icon: "error"
                    });
                    return;

                case 'suspension_conflict':
                    Swal.fire({
                        title: "Cannot Add Schedule",
                        text: "Employee is suspended during this period",
                        html: `Period: ${conflict.start} to ${conflict.end}`,
                        icon: "error"
                    });
                    return;

                case 'availability_conflict':
                    Swal.fire({
                        icon: "warning",
                        title: "Employee Unavailability",
                        html: `
                            <p>The employee is unavailable during this period:</p>
                            <p><strong>${conflict.title}</strong></p>
                            <p>${conflict.start} to ${conflict.end}</p>
                            <p>Do you want to schedule anyway?</p>
                        `,
                        showDenyButton: true,
                        showCancelButton: true,
                        confirmButtonText: "Yes, Schedule",
                        denyButtonText: "No, Cancel",
                        confirmButtonColor: '#158E52',
                        denyButtonColor: '#dc3545'
                    }).then((result) => {
                        if (result.isConfirmed) {
                            // Clear any existing overrides and add new override
                            this.clearAllOverrides();
                            this.addOverrideDate(info.resource.id, selectedDate);

                            // Open modal for adding shift
                            this.openModal('add', {
                                ...info,
                                startStr: DateUtility.formatDate(selectedDate)
                            });
                        }
                    });
                    return;

                default:
                    console.warn('Unknown conflict type:', conflict.type);
                    break;
            }
        } else {
            // No conflicts - proceed with normal add
            this.openModal('add', {
                ...info,
                startStr: DateUtility.formatDate(selectedDate)
            });
        }
    },

    handleEventClick: function (info) {
        // Get the resource from the event
        const resource = info.event.getResources()[0];
        console.group('handleEventClick');
        console.log('info.event.start', info.event.start);
        console.log('info.event.end', info.event.end);
        console.log('DateUtility.parseShiftDate(info.event.start)', DateUtility.parseShiftDate(info.event.start));
        console.log('DateUtility.subtractDays(DateUtility.parseShiftDate(info.event.end), 1)', DateUtility.subtractDays(DateUtility.parseShiftDate(info.event.end), 1));
        console.groupEnd();
        // If it's a background event (availability/time-off), show info and return
        if (info.event.display === 'background') {
            const start = DateUtility.formatDate(DateUtility.parseShiftDate(info.event.start));
            const end = DateUtility.formatDate(DateUtility.subtractDays(DateUtility.parseShiftDate(info.event.end), 1));

            Swal.fire({
                title: `Unavailability: ${info.event.title}`,
                html: `Period: ${start} to ${end}`,
                icon: "warning"
            });
            return;
        }

        // Parse the clicked date using DateUtility
        const clickedDate = DateUtility.parseShiftDate(info.event.start);
        if (!clickedDate) {
            console.error('Invalid event date:', info.event.start);
            Swal.fire({
                title: "Error",
                text: "Invalid event date",
                icon: "error"
            });
            return;
        }

        // Check for availability conflicts
        const conflict = this.checkAvailability(
            resource.id,
            clickedDate
        );

        console.log('handleEventClick ::: conflict', conflict);

        // Handle different conflict scenarios
        if (conflict) {
            switch (conflict.type) {
                case 'suspension_conflict':
                    // Employee is suspended - prevent editing
                    Swal.fire({
                        title: "Cannot Edit Schedule",
                        text: "Employee is suspended during this period",
                        html: `Period: ${conflict.start} to ${conflict.end}`,
                        icon: "error"
                    });
                    return;

                case 'shift_conflict':
                    // Multiple shifts detected - still allow editing of current shift
                    console.log('Allowing edit of existing shift despite conflict');
                    this.renderPositionOptions(resource, "edit", info.event);
                    this.openModal('edit', info);
                    return;

                case 'availability_conflict':
                    // Employee is unavailable but already has a shift
                    Swal.fire({
                        title: `Cannot edit: Employee is ${conflict.title}`,
                        html: `Period: ${conflict.start} to ${conflict.end}`,
                        icon: "warning",
                        showCancelButton: true,
                        confirmButtonText: 'Edit Anyway',
                        cancelButtonText: 'Cancel',
                    }).then((result) => {
                        if (result.isConfirmed) {
                            // Override availability and open edit modal
                            this.clearAllOverrides();
                            this.addOverrideDate(resource.id, clickedDate);
                            this.renderPositionOptions(resource, "edit", info.event);
                            this.openModal('edit', info);
                        }
                    });
                    return;

                default:
                    console.warn('Unknown conflict type:', conflict.type);
                    break;
            }
        }

        // No conflicts - proceed with normal edit
        this.renderPositionOptions(resource, "edit", info.event);
        this.openModal('edit', info);
    },

    // Update handleEventDrop to handle suspensions console.log('handleEventDrop ::: conflict', conflict);
    handleEventDrop: async function (info) {
        // Check if resource has changed
        if (info.oldResource && info.newResource &&
            info.oldResource._resource.id !== info.newResource._resource.id) {
            info.revert();
            await Swal.fire({
                title: 'Invalid Move',
                text: 'Shifts cannot be moved between employees.',
                icon: 'error'
            });
            return;
        }

        // Get resource and parse date using DateUtility
        const resourceId = info.event.getResources()[0].id;
        const newDate = DateUtility.parseShiftDate(info.event.start);

        if (!newDate) {
            console.error('Invalid drop date:', info.event.start);
            info.revert();
            await Swal.fire({
                title: 'Error',
                text: 'Invalid date selection.',
                icon: 'error'
            });
            return;
        }

        // Check for availability conflicts using parsed date
        const conflict = this.checkAvailability(resourceId, newDate);

        if (conflict) {
            if (conflict.type === 'suspension_conflict' || conflict.type === 'shift_conflict') {
                const message = conflict.type === 'suspension_conflict'
                    ? "Employee is suspended during this period"
                    : "Employee already has a shift scheduled for this day";

                await Swal.fire({
                    title: "Cannot Move Schedule",
                    text: message,
                    html: `Period: ${conflict.start} to ${conflict.end}`,
                    icon: "error"
                });
                info.revert();
                return;
            }

            // Handle availability conflict with confirmation
            const result = await Swal.fire({
                icon: "warning",
                title: "Employee Unavailability",
                html: `
    <p>The employee is unavailable during this period:</p>
    <p><strong>${conflict.title}</strong></p>
    <p>${conflict.start} to ${conflict.end}</p>
    <p>Do you want to move the shift anyway?</p>
`,
                showCancelButton: true,
                confirmButtonText: "Yes, Move Shift",
                cancelButtonText: "No, Cancel",
                confirmButtonColor: '#158E52',
                cancelButtonColor: '#dc3545'
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
        // console.group('checkAvailability');
        try {
            // Parse and validate the check date
            const checkDate = DateUtility.parseShiftDate(date);
            if (!checkDate) {
                console.error('Invalid date provided to checkAvailability');
                return null;
            }

            const checkDateStr = DateUtility.formatDate(checkDate);

            // First check if there's already a shift scheduled (preventing multiple shifts)
            const existingShift = this.shifts.find(shift => {
                const shiftDate = DateUtility.parseShiftDate(shift.start);
                if (!shiftDate) return false;

                const shiftDateStr = DateUtility.formatDate(shiftDate);
                return shift.resourceId === resourceId && shiftDateStr === checkDateStr;
            });

            // console.log('checkDate', checkDate);
            // console.log('existingShift', existingShift);

            // If there's already a shift, return a special conflict message
            if (existingShift) {
                return {
                    title: "Already Scheduled",
                    start: DateUtility.formatDate(DateUtility.parseShiftDate(existingShift.start)),
                    end: DateUtility.formatDate(DateUtility.parseShiftDate(existingShift.start)),
                    type: 'shift_conflict'
                };
            }

            // Then check for availability conflicts using the DateUtility functions
            const availabilityConflict = this.availability.find(availability => {
                try {
                    if (availability.resourceId !== resourceId) return false;

                    const availStartDate = DateUtility.parseShiftDate(availability.start);
                    const availEndDate = DateUtility.parseShiftDate(availability.end);

                    if (!availStartDate || !availEndDate) return false;

                    // Subtract one day from end date to account for the inclusive range
                    const adjustedEndDate = DateUtility.subtractDays(availEndDate, 1);

                    // console.log('availStartDate', availStartDate);
                    // console.log('availEndDate', availEndDate);
                    // console.log('isDateInRange', DateUtility.isDateInRange(checkDate, availStartDate, adjustedEndDate));

                    return DateUtility.isDateInRange(checkDate, availStartDate, adjustedEndDate);
                } catch (error) {
                    console.error('Error checking availability:', error, availability);
                    return false;
                }
            });

            // If there's no availability conflict, employee is available
            if (!availabilityConflict) {
                return null;
            }

            // Return conflict details with special handling for suspensions
            const conflictStartDate = DateUtility.parseShiftDate(availabilityConflict.start);
            const conflictEndDate = DateUtility.parseShiftDate(availabilityConflict.end);

            // Adjust end date for display (subtract one day to show actual last day)
            const adjustedEndDate = DateUtility.subtractDays(conflictEndDate, 1);

            return {
                ...availabilityConflict,
                start: DateUtility.formatDate(conflictStartDate),
                end: DateUtility.formatDate(adjustedEndDate),
                type: availabilityConflict.title === 'Suspension' ?
                    'suspension_conflict' :
                    'availability_conflict'
            };

        } catch (error) {
            console.error('Error in checkAvailability:', error);
            return null;
        }
        // console.groupEnd();
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
            if (bsModal) {
                this.modalFormData.delete(bsModal);
            }

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
        // console.log('positions', positions);

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
        const bsModal = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);

        this.toggleLoader(false);
        this.clearError();

        modalTitle.textContent = mode === 'add' ? 'Add Shift' : 'Edit Shift';

        // Parse and validate dates using DateUtility
        const startDate = mode === 'add'
            ? info.startStr  // This contains the YYYY-MM-DD format directly
            : info.event.startStr;

        if (!startDate) {
            console.error('Invalid date in openModal:', mode === 'add' ? info.startStr : info.event.startStr);
            Swal.fire({
                title: 'Error',
                text: 'Invalid date selected. Please try again.',
                icon: 'error'
            });
            return;
        }

        // Format date consistently using DateUtility
        const formattedDate = DateUtility.formatDate(startDate);
        // console.group('openModal');
        // console.log('info.event', info.event);
        // console.log('info', info);
        // console.log('formattedDate', formattedDate);
        // console.log('startDate', startDate);
        // console.groupEnd()
        // Prepare form data with validated information
        const formData = {
            operationId: this.generateOperationId(),
            mode,
            resourceId: mode === 'add' ? info.resource.id : info.event.getResources()[0].id,
            eventId: mode === 'edit' ? info.event.id : null,
            startDate: formattedDate,
            position: mode === 'edit' ? info.event.extendedProps?.positionId?.[0] || '' : '',
            positionDisplayText: mode === 'edit' ? info.event.title : '',
            notes: mode === 'edit' ? info.event.extendedProps.notes || '' : '',
            tags: mode === 'edit' ? info.event.extendedProps.tags || [] : [],
            tags2: mode === 'edit' ? info.event.extendedProps.tags2 || [] : [],
            publishStatus: mode === 'edit'
                ? (info.event.extendedProps.publishStatus === 'Published' ? 'Re-Publish' : 'Not Published')
                : 'Not Published'
        };

        // Store the form data
        this.modalFormData.set(bsModal, formData);

        // Set modal data attributes for compatibility
        modal.dataset.mode = mode;
        modal.dataset.resourceId = formData.resourceId;
        modal.dataset.start = formData.startDate;

        if (mode === 'edit') {
            modal.dataset.eventId = formData.eventId;
            // Add override date using validated date
            this.addOverrideDate(info.event.getResources()[0].id, startDate);
        }

        // Initialize date picker
        this.initializeDatePicker();

        // Set form values with validated dates
        if (mode === 'add') {
            this.datePicker.setDate(startDate);
            employeeInput.value = info.resource.title;
            positionSelect.value = '';
            this.renderPositionOptions(info.resource, mode, null);
            notesInput.value = '';
        } else {
            this.datePicker.setDate(startDate);
            employeeInput.value = info.event.getResources()[0].title;
            positionSelect.value = info.event.title.toLowerCase();
            this.renderPositionOptions(info.event.getResources()[0], mode, info.event);
            notesInput.value = formData.notes;
        }

        // Populate tags based on the mode and available data
        if (mode === 'add') {
            this.populateTags(info.resource, mode);
        } else {
            this.populateTags(info.event.getResources()[0], mode, info.event);
        }

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
        const bsModal = bootstrap.Modal.getInstance(modal);
        const position = document.getElementById('hunkpro-shift-position').value;
        const notesInput = document.getElementById('hunkpro-shift-notes').value;

        // Get the stored form data
        const formData = this.modalFormData.get(bsModal);
        if (!formData) {
            console.error('No form data found for modal');
            this.showError('Error processing form data. Please try again.');
            return;
        }

        const isAddMode = formData.mode === 'add';

        this.clearError();

        if (!position || position.trim() === '') {
            this.showError('Please select a position before continuing');
            return;
        }

        // Get current selected tags
        const selectedTags = this.getSelectedTags();
        const tagIds = selectedTags.map(tag => tag.id);

        try {
            this.toggleLoader(true, isAddMode ? 'Adding Shift...' : 'Updating Shift...');

            const positionDisplayText = $('#hunkpro-shift-position option:selected').text();
            const selectedDate = this.datePicker.formatDate(
                this.datePicker.selectedDates[0],
                "Y-m-d"
            );

            // Create event data
            const eventData = {
                id: formData.operationId,
                resourceId: formData.resourceId,
                title: positionDisplayText,
                start: selectedDate,
                allDay: true,
                classNames: [`hunkpro-shift-${positionDisplayText.toLowerCase().replace(/\s+/g, '')}`],
                extendedProps: {
                    publishStatus: formData.publishStatus,
                    hasNotes: notesInput.trim().length > 0,
                    notes: notesInput,
                    tags: tagIds,
                    tags2: selectedTags,
                    syncStatus: 'syncing',
                    positionId: [position],
                    operationId: formData.operationId
                }
            };

            let calendarEvent;

            // Add or update the calendar event first
            if (isAddMode) {
                calendarEvent = this.calendar.addEvent(eventData);
                this.trackOperation(formData.operationId, calendarEvent, 'add');
            } else {
                const existingEvent = this.calendar.getEventById(formData.eventId);
                if (existingEvent) {
                    this.trackOperation(formData.operationId, existingEvent, 'update');

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

            // Close modal and clean up stored data before API call
            this.modalFormData.delete(bsModal);
            bsModal.hide();

            // Make API call based on mode
            if (isAddMode) {
                const response = await this.addShift({
                    operationId: formData.operationId,
                    user: formData.resourceId,
                    position: position,
                    date: selectedDate,
                    tags: tagIds,
                    notes: notesInput
                });

                const freshShiftData = await this.fetchScheduleById(response.id);
                this.pendingOperations.get(formData.operationId).status = 'success';
                this.shifts.push(freshShiftData);

                if (calendarEvent && !calendarEvent.isDeleted) {
                    calendarEvent.remove();
                }

                this.calendar.addEvent(freshShiftData);

            } else {
                const response = await this.updateShift({
                    operationId: formData.operationId,
                    id: formData.eventId,
                    date: selectedDate,
                    position: position,
                    tags: tagIds,
                    notes: notesInput,
                    publishStatus: eventData.extendedProps.publishStatus
                });

                const freshShiftData = await this.fetchScheduleById(formData.eventId);
                this.pendingOperations.get(formData.operationId).status = 'success';

                const shiftIndex = this.shifts.findIndex(s => s.id === formData.eventId);
                if (shiftIndex !== -1) {
                    this.shifts[shiftIndex] = freshShiftData;
                }

                if (calendarEvent && !calendarEvent.isDeleted) {
                    calendarEvent.remove();
                    this.calendar.addEvent(freshShiftData);
                }
            }

            this.updateAllCounts();

        } catch (error) {
            console.error('Error handling form submit:', error);

            const operation = this.pendingOperations.get(formData.operationId);
            if (operation && operation.event && !operation.event.isDeleted) {
                operation.event.setExtendedProp('syncStatus', 'error');

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
            setTimeout(() => {
                this.pendingOperations.delete(formData.operationId);
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
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
        if (!dateInfo) return 0;

        return this.shifts.filter(shift => {
            const shiftDate = DateUtility.parseShiftDate(shift.start);
            return shift.resourceId === resourceId &&
                shiftDate &&
                DateUtility.isDateInRange(shiftDate, dateInfo.start, dateInfo.adjustedEnd);
        }).length;
    },


    getDailyShiftCounts: function () {
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
        if (!dateInfo) return {};

        const dailyCounts = {};

        // Initialize counts for each day in view
        let currentDate = dateInfo.start;
        while (currentDate <= dateInfo.adjustedEnd) {
            dailyCounts[DateUtility.formatDate(currentDate)] = 0;
            currentDate = DateUtility.addDays(currentDate, 1);
        }

        // Count shifts for each day
        this.shifts.forEach(shift => {
            const shiftDate = DateUtility.parseShiftDate(shift.start);
            if (shiftDate && DateUtility.isDateInRange(shiftDate, dateInfo.start, dateInfo.adjustedEnd)) {
                const dateStr = DateUtility.formatDate(shiftDate);
                dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
            }
        });

        return dailyCounts;
    },

    updateAllCounts: async function () {
        // Ensure calendar is rendered
        if (!this.calendar.isRendered) return;

        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);
        if (!dateInfo) return;

        // Process tag statistics for each day
        let currentDate = dateInfo.start;
        while (currentDate <= dateInfo.adjustedEnd) {
            this.processTagStatistics(currentDate);
            currentDate = DateUtility.addDays(currentDate, 1);
        }

        // Update unpublished counts
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

        // Update day header counts
        const dailyCounts = this.getDailyShiftCounts();
        Object.entries(dailyCounts).forEach(([dateStr, count]) => {
            const headerEl = this.calendar.el.querySelector(`[data-date="${dateStr}"]`);
            if (headerEl) {
                let countEl = headerEl.querySelector('.hunkpro-header-count');
                if (!countEl) {
                    countEl = document.createElement('div');
                    countEl.className = 'hunkpro-header-count';
                    headerEl.appendChild(countEl);
                }
                countEl.textContent = `(${count})`;
            }
        });

        // Force calendar rerender
        this.calendar.render();
    },

    TimeZoneHelper: {
        toLocalMidnight: function (date) {
            if (!date) return null;
            const d = new Date(date);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        },

        fromLocalToUTC: function (date) {
            if (!date) return null;
            const d = this.toLocalMidnight(date);
            return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        }
    },

    initializeDatePicker: function () {
        const dateInput = document.getElementById('hunkpro-shift-date');
        const modal = document.getElementById('hunkpro-shift-modal');
        const isEditMode = modal.dataset.mode === 'edit';
        const currentEventId = isEditMode ? modal.dataset.eventId : null;
        const dateInfo = DateUtility.getViewDateInfo(this.calendar.view);

        if (this.datePicker) {
            this.datePicker.destroy();
        }

        this.datePicker = flatpickr(dateInput, {
            dateFormat: "Y-m-d",
            defaultDate: dateInfo.today,
            enableTime: false,
            utc: true,
            locale: {
                firstDayOfWeek: 1
            },
            minDate: dateInfo.startStr,
            maxDate: dateInfo.endStr,

            // Wrap the disable function with timezone handling
            disable: [
                (date) => {
                    const resourceId = modal.dataset.resourceId;
                    if (!resourceId) return false;

                    // Convert picked date to UTC midnight for consistent comparison
                    const utcDate = this.TimeZoneHelper.fromLocalToUTC(date);
                    const checkDate = DateUtility.parseShiftDate(utcDate);

                    if (!checkDate) return true;

                    const checkDateStr = DateUtility.formatDate(checkDate);

                    // Check if date is within view
                    const isInView = dateInfo.isWithinView(checkDate);
                    if (!isInView) return true;

                    // Check for existing shifts
                    const existingShift = this.shifts.find(shift => {
                        const shiftDate = DateUtility.parseShiftDate(shift.start);
                        if (!shiftDate) return false;

                        const shiftDateStr = DateUtility.formatDate(shiftDate);
                        return shift.resourceId === resourceId &&
                            shiftDateStr === checkDateStr &&
                            shift.id !== currentEventId;
                    });

                    if (existingShift) return true;

                    // Check overrides
                    if (this.isDateOverridden(resourceId, checkDate)) return false;

                    // Check availability conflicts
                    return this.availability.some(avail => {
                        if (avail.resourceId !== resourceId) return false;

                        const startDate = DateUtility.parseShiftDate(avail.start);
                        const endDate = DateUtility.parseShiftDate(avail.end);

                        if (!startDate || !endDate) return false;

                        const adjustedEndDate = DateUtility.subtractDays(endDate, 1);
                        return DateUtility.isDateInRange(checkDate, startDate, adjustedEndDate);
                    });
                }
            ],

            onOpen: function (selectedDates, dateStr, instance) {
                instance.jumpToDate(instance.selectedDates[0] || dateInfo.start);
            },

            onChange: (selectedDates, dateStr) => {
                // Use timezone helper for any onChange handling if needed
                const localDate = this.TimeZoneHelper.toLocalMidnight(selectedDates[0]);
                console.log('Selected local date:', localDate);
            }
        });

        return this.datePicker;
    },
    // Add override for specific employee and date
    addOverrideDate: function (employeeId, date) {
        const parsedDate = DateUtility.parseShiftDate(date);
        if (!parsedDate) {
            console.error('Invalid date for override:', date);
            return;
        }

        const dateStr = DateUtility.formatDate(parsedDate);
        if (!this.overrideDates.has(employeeId)) {
            this.overrideDates.set(employeeId, new Set());
        }
        this.overrideDates.get(employeeId).add(dateStr);
    },

    // Remove override for specific employee and date
    removeOverrideDate: function (employeeId, date) {
        const parsedDate = DateUtility.parseShiftDate(date);
        if (!parsedDate) {
            console.error('Invalid date for override removal:', date);
            return;
        }

        const dateStr = DateUtility.formatDate(parsedDate);
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
        const parsedDate = DateUtility.parseShiftDate(date);
        if (!parsedDate) {
            console.error('Invalid date for override check:', date);
            return false;
        }

        const dateStr = DateUtility.formatDate(parsedDate);
        return this.overrideDates.has(employeeId) &&
            this.overrideDates.get(employeeId).has(dateStr);
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