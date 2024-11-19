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

            // Load initial data
            const employees = await this.fetchEmployees();
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

            this.hideFullScreenLoader();
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
        return new Promise((resolve, reject) => {
            $.ajax({
                "url": `https://api.tadabase.io/api/v1/data-tables/4MXQJdrZ6v/records?filters[items][0][field_id]=field_427&filters[items][0][operator]=contains_any&filters[items][0][val]=Truck Operations&filters[items][1][field_id]=status&filters[items][1][operator]=is&filters[items][1][val]=Active`,
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
                    const parsedData = JSON.parse(data);
                    // console.log('Employees', parsedData);
                    const users = parsedData.items.map(item => ({
                        id: item.id,
                        title: item.name,
                        extendedProps: {
                            department: item.field_427 || [],
                            status: item.status,
                            weeklyShifts: 0,
                            position: item.field_395_val,
                        }
                    }));
                    resolve(users);
                },
                error: function (error) {
                    console.error('Error fetching employees:', error);
                    reject(error);
                }
            });
        });
    },

    fetchSchedules: function () {
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // console.log(`fetchSchedules ${viewStart} ${viewEnd}`);

        const startDate = viewStart.toISOString().split('T')[0];
        const endDate = viewEnd.toISOString().split('T')[0];

        console.log(`fetchSchedules ${startDate} ${endDate}`);

        // Define the mapping between position types and CSS classes
        const positionClassMap = {
            'Closer': 'hunkpro-shift-closer',
            'Morning Dispatch': 'hunkpro-shift-morningdispatch',
            'Trainer': 'hunkpro-shift-trainer',
            'Estimator': 'hunkpro-shift-estimator',
            'Captain - Paperwork Only': 'hunkpro-shift-captainpaperworkonly',
            'Captain - Driver Only': 'hunkpro-shift-captaindriveronly',
            'Captain - Full': 'hunkpro-shift-captainfull',
            'Wingman': 'hunkpro-shift-wingman'
        };

        return new Promise((resolve, reject) => {
            $.ajax({
                "url": `https://api.tadabase.io/api/v1/data-tables/lGArg7rmR6/records?filters[items][0][field_id]=field_60&filters[items][0][operator]=is%20on%20or%20after&filters[items][0][val]=${startDate}&filters[items][1][field_id]=field_60&filters[items][1][operator]=is%20on%20or%20before&filters[items][1][val]=${endDate}`,
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
                    const parsedData = JSON.parse(data);
                    // console.log('Schedules raw data:', parsedData);

                    const schedules = parsedData.items.map(item => {
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
                            const cssClass = positionClassMap[positionName] || 'hunkpro-shift-default';

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
                                allDay: true
                            };
                        } catch (err) {
                            console.error('Error processing schedule item:', err, item);
                            return null;
                        }
                    }).filter(schedule => schedule !== null);

                    // console.log('Processed schedules:', schedules);
                    resolve(schedules);
                },
                error: function (error) {
                    console.error('Error fetching schedules:', error);
                    reject(error);
                }
            });
        });
    },
    fetchAvailability: function () {
        const viewStart = this.calendar.view.activeStart;
        const viewEnd = this.calendar.view.activeEnd;

        // console.log(`fetchAvailability ${viewStart} ${viewEnd}`);

        // Add buffer days
        const bufferStart = new Date(viewStart);
        bufferStart.setDate(bufferStart.getDate() - 7);

        const bufferEnd = new Date(viewEnd);
        bufferEnd.setDate(bufferEnd.getDate() + 7);

        const startDate = bufferStart.toISOString().split('T')[0];
        const endDate = bufferEnd.toISOString().split('T')[0];

        console.log(`fetchAvailability ${startDate} ${endDate}`);

        const classMap = this.availabilityClassMap;

        return new Promise((resolve, reject) => {
            $.ajax({
                "url": `https://api.tadabase.io/api/v1/data-tables/eykNOvrDY3/records?filters[items][0][field_id]=field_428-start&filters[items][0][operator]=is%20on%20or%20before&filters[items][0][val]=${endDate}&filters[items][1][field_id]=field_428-end&filters[items][1][operator]=is%20on%20or%20after&filters[items][1][val]=${startDate}&filters[items][2][field_id]=field_67&filters[items][2][operator]=is%20not&filters[items][2][val]=Regular%20Day%20Off`,
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
                success: (data) => {
                    const parsedData = JSON.parse(data);
                    const availability = parsedData.items.map(item => {
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
                },
                error: function (error) {
                    console.error('Error fetching availability:', error);
                    reject(error);
                }
            });
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

        console.log(`fetchRegularDayOffs ${startDate} ${endDate}`);

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
                                    eventDate.setHours(12, 0, 0, 0);
                                    const formattedEventDate = eventDate.toISOString().split('T')[0];

                                    // Create next day date properly
                                    const nextDay = new Date(eventDate);
                                    nextDay.setDate(nextDay.getDate() + 1);
                                    const formattedNextDay = nextDay.toISOString().split('T')[0];

                                    const hasExistingAvailability = this.availability.some(avail => {
                                        // Normalize start date to beginning of day
                                        const availStartDate = new Date(avail.start);
                                        availStartDate.setHours(0, 0, 0, 0);

                                        // Normalize end date to end of day
                                        // Also subtract one day since end dates are exclusive
                                        const availEndDate = new Date(avail.end);
                                        availEndDate.setDate(availEndDate.getDate() - 1);
                                        availEndDate.setHours(23, 59, 59, 999);

                                        // Normalize check date to noon
                                        const checkDate = new Date(eventDate);
                                        checkDate.setHours(12, 0, 0, 0);

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
        // Create FormData object
        const form = new FormData();
        form.append('field_60', newShift.date); // Date
        form.append('field_58', newShift.user); // Employee
        form.append('field_59', newShift.position); // Position

        // Store reference to 'this' for use in callback
        const self = this;

        // Return promise for better error handling
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
                success: function (response) {
                    console.log('Add Shift Response:', response);
                    // Refresh events after successful addition

                    self.clearAllOverrides();
                    self.refreshEvents().then(resolve).catch(reject);

                },
                error: function (error) {
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
                    self.refreshEvents().then(resolve).catch(reject);
                },
                error: function (error) {
                    console.error('Error editing shift:', error);
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
        adjustedViewEnd.setHours(23, 59, 59, 999);

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

            console.log(`Refreshing events... (${isInitialLoad ? 'initial load' : 'update'})`);

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

            // Simplified header toolbar
            headerToolbar: {
                left: 'today prev,next',
                center: 'title',
                right: 'copyWeek refresh'
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

            // Core event handlers
            // Also update the datesSet handler in initializeCalendar
            datesSet: async (dateInfo) => {
                try {
                    // Only refresh if it's a navigation change
                    if (this._lastViewStart?.getTime() !== dateInfo.start.getTime()) {
                        // console.log('Date range changed:', {
                        //     start: dateInfo.start,
                        //     end: dateInfo.end,
                        //     lastStart: this._lastViewStart
                        // });

                        this._lastViewStart = dateInfo.start;
                        console.log('refresh events from dataSet()');
                        await this.refreshEvents();
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

            eventContent: (arg) => {
                if (arg.event.display !== 'background') {
                    return {
                        html: `<div class="hunkpro-event-content"><div class="hunkpro-event-title">${arg.event.title}</div></div>`
                    };
                }
                // return null;
                return `${arg.event.title}`;
            }
        });

        // Initialize calendar
        this.calendar.render();
        this.initializeModalHandlers();

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

    showCopyWeekDialog: function () {
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

            // Create Date objects using UTC to avoid timezone issues
            const weekStart = new Date(Date.UTC(
                currentView.activeStart.getFullYear(),
                currentView.activeStart.getMonth(),
                currentView.activeStart.getDate()
            ));

            const weekEnd = new Date(Date.UTC(
                currentView.activeEnd.getFullYear(),
                currentView.activeEnd.getMonth(),
                currentView.activeEnd.getDate() - 1  // Subtract 1 from end date only if needed for display
            ));

            // Calculate next week's dates
            const nextWeekStart = new Date(weekStart);
            nextWeekStart.setDate(nextWeekStart.getDate() + 7);

            const nextWeekEnd = new Date(weekEnd);
            nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

            // Format dates for display using UTC to ensure consistency
            const formatDate = (date) => {
                return date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC'
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
                    return this.copyWeekSchedules(weekStart, weekEnd)
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

    // Updated copyWeekSchedules function with proper error handling and API interaction
    copyWeekSchedules: async function (weekStart, weekEnd) {
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
                        this.openModal('add', info);
                    }
                });
            }
        } else {
            this.openModal('add', info);
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
        clickedDate.setHours(12, 0, 0, 0);

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
        // First check if there's already a shift scheduled (preventing multiple shifts)
        const checkDate = new Date(date);
        checkDate.setHours(0, 0, 0, 0);

        const existingShift = this.shifts.find(shift => {
            const shiftDate = new Date(shift.start);
            shiftDate.setHours(0, 0, 0, 0);

            return shift.resourceId === resourceId &&
                shiftDate.getTime() === checkDate.getTime();
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
                // Create dates for comparison
                const startDate = new Date(a.start);
                startDate.setHours(0, 0, 0, 0);

                // Create end date and subtract one day to account for the UI adjustment
                const endDate = new Date(a.end);
                endDate.setDate(endDate.getDate() - 1); // Subtract one day
                endDate.setHours(23, 59, 59, 999);

                const checkDate = new Date(date);
                checkDate.setHours(12, 0, 0, 0);

                return a.resourceId === resourceId &&
                    checkDate >= startDate &&
                    checkDate <= endDate;
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

        formLoader.style.display = 'none';
        formLoader.classList.add('chhj-hide');
        formOptions.style.display = 'flex';
        formOptions.classList.remove('chhj-hide');

        // Initialize Bootstrap modal
        const bsModal = new bootstrap.Modal(modal);

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
            this.clearAllOverrides(); // Ensure overrides are cleared when modal is closed
            // Destroy datepicker to ensure clean slate for next opening
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

        this.toggleLoader(false);
        this.clearError();

        modalTitle.textContent = mode === 'add' ? 'Add Shift' : 'Edit Shift';

        // Set modal data attributes before initializing date picker
        modal.dataset.mode = mode;
        modal.dataset.resourceId = mode === 'add' ? info.resource.id : info.event.getResources()[0].id;
        modal.dataset.start = mode === 'add' ? info.startStr : info.event.startStr;
        if (mode === 'edit') {
            modal.dataset.eventId = info.event.id;
            const eventDate = new Date(info.event.start);
            this.addOverrideDate(info.event.getResources()[0].id, eventDate);
        }

        // Initialize date picker after setting modal data
        this.initializeDatePicker();

        // Set values after date picker is initialized
        if (mode === 'add') {
            this.datePicker.setDate(info.start);
            employeeInput.value = info.resource.title;
            positionSelect.value = '';
            this.renderPositionOptions(info.resource, mode, null);
        } else {
            this.datePicker.setDate(info.event.start);
            employeeInput.value = info.event.getResources()[0].title;
            positionSelect.value = info.event.title.toLowerCase();
            this.renderPositionOptions(info.event.getResources()[0], mode, info.event);
        }

        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    },

    // Update handleFormSubmit to use Bootstrap modal
    handleFormSubmit: async function () {
        const modal = document.getElementById('hunkpro-shift-modal');
        const position = document.getElementById('hunkpro-shift-position').value;
        const isAddMode = modal.dataset.mode === 'add';

        this.clearError();

        if (!position || position.trim() === '') {
            this.showError('Please select a position before continuing');
            return;
        }

        try {
            this.toggleLoader(true, isAddMode ? 'Adding Shift...' : 'Updating Shift...');

            if (isAddMode) {
                const selectedDate = this.datePicker.formatDate(
                    this.datePicker.selectedDates[0],
                    "Y-m-d"
                );
                const newShift = {
                    user: modal.dataset.resourceId,
                    position: position,
                    date: selectedDate
                };

                await this.addShift(newShift);
            } else {
                const event = this.calendar.getEventById(modal.dataset.eventId);
                const selectedDate = this.datePicker.formatDate(
                    this.datePicker.selectedDates[0],
                    "Y-m-d"
                );

                await this.updateShift({
                    id: event?.id || '',
                    date: selectedDate,
                    position: $('#hunkpro-shift-position').val() || ''
                });
            }

            // Close modal before refresh to prevent UI lag
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();

            // Refresh events after modal is closed
            await this.refreshEvents();

        } catch (error) {
            console.error('Error handling form submit:', error);
            this.toggleLoader(false);
            this.showError('Failed to save shift. Please try again.');
        } finally {
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

    eventDropUpdate: function (event) {
        const shiftIndex = this.shifts.findIndex(s => s.id === event.id);
        if (shiftIndex !== -1) {
            this.shifts[shiftIndex] = {
                ...this.shifts[shiftIndex],
                resourceId: event.getResources()[0].id,
                start: event.startStr
            };
            this.updateShift({
                id: event?.id || '',
                date: event?.startStr || '',
                position: event?.extendedProps?.positionId?.[0] || ''
            });
        }
        this.updateAllCounts();
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
        // Normalize both dates to midnight UTC for consistent comparison
        const normalizedTargetDate = new Date(date);
        normalizedTargetDate.setHours(0, 0, 0, 0);

        return this.shifts.filter(shift => {
            const shiftDate = new Date(shift.start);
            shiftDate.setHours(0, 0, 0, 0);
            return shiftDate.getTime() === normalizedTargetDate.getTime();
        }).length;
    },

    updateAllCounts: function () {
        // Ensure calendar is rendered before updating counts
        if (!this.calendar.isRendered) {
            return;
        }

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

                    // Convert date to consistent format for comparison
                    const checkDate = new Date(date);
                    checkDate.setHours(12, 0, 0, 0);

                    // Check if date is within current view range
                    if (checkDate < viewStart || checkDate >= viewEnd) {
                        return true;
                    }

                    // Check for shifts on this date
                    const existingShift = this.shifts.find(shift => {
                        const shiftDate = new Date(shift.start);
                        shiftDate.setHours(0, 0, 0, 0);
                        return shift.resourceId === resourceId &&
                            shiftDate.getTime() === new Date(date).setHours(0, 0, 0, 0) &&
                            shift.id !== currentEventId; // Don't block current shift in edit mode
                    });

                    // If there's a shift and we're not editing that specific shift, disable the date
                    if (existingShift) {
                        return true;
                    }

                    // Check if date is overridden (from previous availability override)
                    if (this.isDateOverridden(resourceId, date)) {
                        return false;
                    }

                    // Check for availability conflicts
                    const availabilityConflict = this.availability.some(avail => {
                        if (avail.resourceId !== resourceId) return false;

                        const startDate = new Date(avail.start);
                        const endDate = new Date(avail.end);
                        endDate.setDate(endDate.getDate() - 1);

                        startDate.setHours(0, 0, 0, 0);
                        endDate.setHours(23, 59, 59, 999);

                        return checkDate >= startDate && checkDate <= endDate;
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
                // Additional onChange logic if needed
            },

            onClose: () => {
                const resourceId = modal.dataset.resourceId;
                if (resourceId) {
                    // Cleanup logic if needed
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