CTFd._internal.challenge.data = undefined;

CTFd._internal.challenge.renderer = CTFd._internal.markdown;

// Track status intervals for cleanup
var statusIntervals = {};

CTFd._internal.challenge.preRender = function() {}

CTFd._internal.challenge.render = function(markdown) {
    return CTFd._internal.challenge.renderer.parse(markdown)
}

CTFd._internal.challenge.postRender = function() {
    const containername = CTFd._internal.challenge.data.docker_image;
    get_docker_status(containername);
    createWarningModalBody();
    
    // Add periodic check every 30 seconds to ensure auto-kill is working
    if (!window.autoKillCheck) {
        window.autoKillCheck = setInterval(() => {
            // Always check to ensure UI is up-to-date with backend auto-kill
            get_docker_status(containername);
        }, 30000); // Check every 30 seconds to catch auto-kills faster
    }
}

function createWarningModalBody(){
    // Creates the Warning Modal placeholder, that will be updated when stuff happens.
    if (CTFd.lib.$('#warningModalBody').length === 0) {
        CTFd.lib.$('body').append('<div id="warningModalBody"></div>');
    }
}

function get_docker_status(container) {
    // Don't fetch status if we're already actively running a timer for this container
    // But allow periodic updates to keep UI in sync
    const currentTime = Date.now();
    if (statusIntervals[container] && statusIntervals[container].lastUpdate && 
        (currentTime - statusIntervals[container].lastUpdate) < 10000) {
        return; // Skip if updated within last 10 seconds
    }
    
    // Get challenge name from CTFd data
    const challenge_name = CTFd._internal.challenge.data.name;
    
    // Use CTFd.fetch to call the API
    CTFd.fetch('/api/v1/docker_status', {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    }).then(function(response) {
        return response.json();
    }).then(function(result) {

        let containerFound = false;
        let containerInfo = null;
        
        // For multi-image challenges, we need to find containers that belong to the same challenge
        // rather than matching docker_image names exactly
        result.data.forEach(item => {
            if (item.challenge_name === challenge_name) {
                containerFound = true;
                if (!containerInfo || item.is_primary) {
                    containerInfo = item;
                }
            }
        });
        

        if (containerFound && containerInfo) {
            // Check if container has expired by comparing with revert_time
            var currentTime = Math.floor(Date.now() / 1000);
            var is_expired = currentTime >= parseInt(containerInfo.revert_time);
            
            if (is_expired) {
                containerFound = false;
                containerInfo = null;
            } else {
                // Split the ports and create the data string
                var ports = String(containerInfo.ports).split(',');
                
                // Get challenge connection type and custom subdomain
                const connectionType = CTFd._internal.challenge.data.connection_type || 'tcp';
                const customSubdomain = CTFd._internal.challenge.data.custom_subdomain || '';
                const challengeType = CTFd._internal.challenge.data.challenge_type || 'single';
                
                // Create connection details HTML based on connection type
                var connectionDetails = '';
                
                if (connectionType === 'web') {
                    // Web challenge - show HTTP/HTTPS URLs
                    ports.forEach(port => {
                        port = String(port).replace('/tcp', '');
                        let url;
                        
                        if (customSubdomain) {
                            // Use custom subdomain
                            url = `http://${customSubdomain}.h7tex.com:${port}`;
                        } else if (containerInfo.host.includes('h7tex.com')) {
                            // Use domain with port
                            url = `http://${containerInfo.host}:${port}`;
                        } else {
                            // Fallback to IP with port
                            url = `http://${containerInfo.host}:${port}`;
                        }
                        
                        connectionDetails += `
                            <div class="connection-item" style="margin: 4px 0;">
                                <a href="${url}" target="_blank" style="color: #60a5fa; text-decoration: none; font-family: monospace; font-size: 13px;">
                                    ${url} <i class="fas fa-external-link-alt" style="font-size: 10px; margin-left: 4px;"></i>
                                </a>
                            </div>
                        `;
                    });
                } else {
                    // TCP challenge - show nc commands
                    ports.forEach(port => {
                        port = String(port).replace('/tcp', '');
                        const command = `nc ${containerInfo.host} ${port}`;
                        connectionDetails += `
                            <div class="connection-item" style="margin: 4px 0;">
                                <code style="font-family: monospace; color: #f87171; font-size: 13px;">${command}</code>
                            </div>
                        `;
                    });
                }
                
                // Update the DOM with docker container information
                const dockerContainer = CTFd.lib.$('#docker_container');
                
                const htmlContent = `
                    <div class="docker-control-panel" style="background: #1f2937; border-radius: 6px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); text-align: center;">
                        <div class="docker-content">
                            <div class="connection-section" style="margin-bottom: 14px;">
                                <h6 style="margin-bottom: 6px; color: #f3f4f6; font-size: 14px; font-weight: 600;">
                                    <i class="fas fa-terminal" style="margin-right: 5px;"></i>
                                    Connection Details
                                </h6>
                                <div class="connection-details">
                                    ${connectionDetails}
                                </div>
                            </div>
                            <div class="timer-section" id="${String(containerInfo.instance_id).substring(0, 10)}_revert_container">
                                <!-- Timer or buttons will appear here -->
                            </div>
                        </div>
                    </div>
                `;
                
                dockerContainer.html(htmlContent);

                // Fix for connection info placeholders
                var $link = CTFd.lib.$('.challenge-connection-info');
                if ($link.length > 0 && $link.html()) {
                    $link.html($link.html().replace(/host/gi, containerInfo.host));
                    $link.html($link.html().replace(/port|\b\d{5}\b/gi, ports[0].split("/")[0]));
                }

                // Auto-link any URLs found
                CTFd.lib.$(".challenge-connection-info").each(function () {
                    const $span = CTFd.lib.$(this);
                    const html = $span.html();
                    if (!html || html.includes("<a")) return;
                    const urlMatch = html.match(/(http[s]?:\/\/[^\s<]+)/);
                    if (urlMatch) {
                        const url = urlMatch[0];
                        $span.html(html.replace(url, `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
                    }
                });

                // Set up countdown timer
                var countDownDate = new Date(parseInt(containerInfo.revert_time) * 1000).getTime();
                
                // Clear any existing interval for this container
                if (statusIntervals[containerInfo.docker_image]) {
                    clearInterval(statusIntervals[containerInfo.docker_image].interval);
                    delete statusIntervals[containerInfo.docker_image];
                }
                
                var x = setInterval(function() {
                    var now = new Date().getTime();
                    var distance = countDownDate - now;
                    var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                    var seconds = Math.floor((distance % (1000 * 60)) / 1000);
                    if (seconds < 10) seconds = "0" + seconds;
                    
                    const timerElement = CTFd.lib.$("#" + String(containerInfo.instance_id).substring(0, 10) + "_revert_container");
                    
                    // Check if timer element still exists
                    if (timerElement.length === 0) {
                        clearInterval(x);
                        delete statusIntervals[containerInfo.docker_image];
                        return;
                    }

                    // Every 20 seconds, verify the container is still running
                    if (now % 20000 < 1000) {
                        CTFd.fetch("/api/v1/docker_status").then(response => response.json())
                        .then(result => {
                            let stillRunning = false;
                            result.data.forEach(statusItem => {
                                if (statusItem.docker_image === containerInfo.docker_image && statusItem.instance_id === containerInfo.instance_id) {
                                    stillRunning = true;
                                }
                            });
                            
                            if (!stillRunning) {
                                clearInterval(x);
                                delete statusIntervals[containerInfo.docker_image];
                                resetToNormalState(containerInfo.docker_image);
                                return;
                            }
                        })
                        .catch(error => {
                            // Silent error handling - continue with timer
                        });
                    }

                    if (distance > 0) {
                        // Update countdown with stop/revert buttons
                        timerElement.html(`
                            <div class="timer-context" style="font-size: 13px; color: #d1d5db; margin-bottom: 6px;">
                                Container will auto-stop in:
                            </div>
                            <div class="docker-timer" style="font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 12px;">
                                ${minutes}:${seconds}
                            </div>
                            <div class="action-buttons" style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                                <button onclick="revert_container('${containerInfo.docker_image}');" style="
                                    background: #1e40af;
                                    border: none; border-radius: 4px; color: #ffffff;
                                    padding: 8px 14px; font-size: 12px; font-weight: 500;
                                    cursor: pointer; min-width: 80px; text-align: center;
                                    display: flex; align-items: center; justify-content: center;">
                                    <i class="fas fa-redo" style="margin-right: 4px; font-size: 10px;"></i> Revert
                                </button>
                                <button onclick="stop_container('${containerInfo.docker_image}');" style="
                                    background: #dc2626;
                                    border: none; border-radius: 4px; color: #ffffff;
                                    padding: 8px 14px; font-size: 12px; font-weight: 500;
                                    cursor: pointer; min-width: 80px; text-align: center;
                                    display: flex; align-items: center; justify-content: center;">
                                    <i class="fas fa-stop" style="margin-right: 4px; font-size: 10px;"></i> Stop
                                </button>
                            </div>
                        `);
                    } else {
                        // Time expired, show revert/stop buttons
                        clearInterval(x);
                        delete statusIntervals[containerInfo.docker_image];
                        
                        const dockerContainer = CTFd.lib.$('#docker_container');
                        const expiredHTML = `
                            <div class="docker-control-panel" style="background: #1f2937; border-radius: 6px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); text-align: center;">
                                <div class="docker-content">
                                    <div class="timer-section" style="display: flex; justify-content: center; align-items: center; width: 100%;">
                                        <div class="docker-actions" style="display: flex; justify-content: center; align-items: center; width: 100%;">
                                            <div class="action-buttons" style="display: flex; gap: 15px; justify-content: center; align-items: center;">
                                                <button onclick="revert_container('${containerInfo.docker_image}');" style="
                                                    background: #1e40af;
                                                    border: none; border-radius: 4px; color: #ffffff;
                                                    padding: 10px 18px; font-size: 13px; font-weight: 500;
                                                    cursor: pointer; min-width: 90px; text-align: center;
                                                    display: flex; align-items: center; justify-content: center;">
                                                    <i class="fas fa-redo" style="margin-right: 5px;"></i> Revert
                                                </button>
                                                <button onclick="stop_container('${containerInfo.docker_image}');" style="
                                                    background: #dc2626;
                                                    border: none; border-radius: 4px; color: #ffffff;
                                                    padding: 10px 18px; font-size: 13px; font-weight: 500;
                                                    cursor: pointer; min-width: 90px; text-align: center;
                                                    display: flex; align-items: center; justify-content: center;">
                                                    <i class="fas fa-stop" style="margin-right: 5px;"></i> Stop
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        dockerContainer.html(expiredHTML);
                        
                        // After 30 seconds of showing revert/stop buttons, auto-reset to launch
                        setTimeout(() => {
                            resetToNormalState(containerInfo.docker_image);
                        }, 30000);
                    }
                }, 1000);
                
                // Track the interval for cleanup with metadata
                statusIntervals[containerInfo.docker_image] = {
                    interval: x,
                    lastUpdate: Date.now(),
                    containerId: containerInfo.instance_id
                };
            }
        }
        
        // If no active container found, show launch button
        if (!containerFound) {
            resetToNormalState(container);
        }
    })
    .catch(error => {
        // On error, show the launch button
        resetToNormalState(container);
    });
}



function stop_container(container) {
    if (confirm("Are you sure you want to stop the container for: \n" + CTFd._internal.challenge.data.name)) {
        // Show loading state immediately
        const loadingHTML = `
            <div class="docker-control-panel">
                <div class="docker-content">
                    <div class="docker-loading" style="text-align:center; padding: 10px;">
                        <div class="loading-spinner" style="margin-bottom: 6px;">
                            <i class="fas fa-spinner fa-spin" style="font-size: 20px; color: #1f2937;"></i>
                        </div>
                        <div class="loading-text" style="font-size: 12px; color: #6b7280;">Stopping container...</div>
                    </div>
                </div>
            </div>
        `;
        CTFd.lib.$('#docker_container').html(loadingHTML);
        
        CTFd.fetch("/api/v1/container?name=" + encodeURIComponent(container) + 
                   "&challenge=" + encodeURIComponent(CTFd._internal.challenge.data.name) + 
                   "&stopcontainer=True", {
            method: "GET"
        })
        .then(function (response) {
            return response.json().then(function (json) {
                if (response.ok && json.success) {
                    // Clear any existing timers for this container
                    if (statusIntervals[container]) {
                        clearInterval(statusIntervals[container]);
                        delete statusIntervals[container];
                    }
                    
                    updateWarningModal({
                        title: "Success",
                        warningText: "Container for <strong>" + CTFd._internal.challenge.data.name + "</strong> was stopped successfully.",
                        buttonText: "Close",
                        onClose: function () {
                            resetToNormalState(container);  // Reset UI to launch button
                        }
                    });
                } else {
                    throw new Error(json.message || 'Failed to stop container');
                }
            });
        })
        .catch(function (error) {
            updateWarningModal({
                title: "Error",
                warningText: error.message || "An error occurred while stopping the container.",
                buttonText: "Close",
                onClose: function () {
                    get_docker_status(container);  // Refresh status on error
                }
            });
        });
    }
}

function revert_container(container) {
    // Show loading state immediately
    const loadingHTML = `
        <div class="docker-control-panel">
            <div class="docker-content">
                <div class="docker-loading" style="text-align:center; padding: 10px;">
                    <div class="loading-spinner" style="margin-bottom: 6px;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 20px; color: #1f2937;"></i>
                    </div>
                    <div class="loading-text" style="font-size: 12px; color: #6b7280;">Reverting container...</div>
                </div>
            </div>
        </div>
    `;
    CTFd.lib.$('#docker_container').html(loadingHTML);
    
    // First, stop the existing container
    CTFd.fetch("/api/v1/container?name=" + encodeURIComponent(container) + 
               "&challenge=" + encodeURIComponent(CTFd._internal.challenge.data.name) + 
               "&stopcontainer=True", {
        method: "GET"
    })
    .then(function (response) {
        return response.json().then(function (json) {
            if (response.ok && json.success) {
                // Clear any existing timers for this container
                if (statusIntervals[container]) {
                    clearInterval(statusIntervals[container]);
                    delete statusIntervals[container];
                }
                
                // Now start a new container
                CTFd.fetch("/api/v1/container?name=" + encodeURIComponent(container) + 
                          "&challenge=" + encodeURIComponent(CTFd._internal.challenge.data.name), {
                    method: "GET"
                })
                .then(function (startResponse) {
                    if (startResponse.ok) {
                        return startResponse.json().then(function (startJson) {
                            if (startJson.success) {
                                get_docker_status(container);
                                
                                // Get instance duration from challenge data, default to 15 minutes
                                const instanceDuration = CTFd._internal.challenge.data.instance_duration || 15;
                                
                                updateWarningModal({
                                    title: "Container Reverted",
                                    warningText: `Your challenge container has been reverted and restarted.<br><small>Restart or stop actions are limited to once every ${instanceDuration} minutes.</small>`,
                                    buttonText: "Close"
                                });
                            } else {
                                throw new Error(startJson.message || 'Failed to start new container');
                            }
                        });
                    } else {
                        throw new Error('Failed to start new container');
                    }
                })
                .catch(function (startError) {
                    updateWarningModal({
                        title: "Revert Failed",
                        warningText: "Container was stopped but failed to restart: " + (startError.message || "Unknown error"),
                        buttonText: "Close",
                        onClose: function () {
                            resetToNormalState(container);
                        }
                    });
                });
            } else {
                throw new Error(json.message || 'Failed to stop existing container');
            }
        });
    })
    .catch(function (error) {
        updateWarningModal({
            title: "Revert Failed",
            warningText: "Failed to stop existing container: " + (error.message || "Unknown error"),
            buttonText: "Close",
            onClose: function () {
                get_docker_status(container);  // Refresh status on error
            }
        });
    });
}

function start_container(container) {
    const loadingHTML = `
        <div class="docker-control-panel">
            <div class="docker-content">
                <div class="docker-loading" style="text-align:center; padding: 10px;">
                    <div class="loading-spinner" style="margin-bottom: 6px;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 20px; color: #1f2937;"></i>
                    </div>
                    <div class="loading-text" style="font-size: 12px; color: #6b7280;">Please wait while the container starts</div>
                </div>
            </div>
        </div>
    `;
    CTFd.lib.$('#docker_container').html(loadingHTML);
    
    CTFd.fetch("/api/v1/container?name=" + encodeURIComponent(container) + "&challenge=" + encodeURIComponent(CTFd._internal.challenge.data.name), {
        method: "GET"
    }).then(function (response) {
        if (response.ok) {
            return response.json().then(function (json) {
                get_docker_status(container);
                
                // Get instance duration from challenge data, default to 15 minutes
                const instanceDuration = CTFd._internal.challenge.data.instance_duration || 15;
                
                updateWarningModal({
                    title: "Instance Deployed",
                    warningText: `Your challenge container is active.<br><small>Restart or stop actions are limited to once every ${instanceDuration} minutes.</small>`,
                    buttonText: "Close"
                });
            });
        } else {
            // Handle error responses (like 403 for already running containers)
            return response.text().then(function (text) {
                // Try to parse as JSON first, fall back to text
                let errorMessage;
                try {
                    const json = JSON.parse(text);
                    errorMessage = json.message || text;
                } catch (e) {
                    errorMessage = text;
                }
                
                updateWarningModal({
                    title: "Deployment Failed",
                    warningText: errorMessage || "An error occurred while starting the container.",
                    buttonText: "Close",
                    onClose: function () {
                        // Reset UI to normal state after modal is closed
                        resetToNormalState(container);
                    }
                });
            });
        }
    }).catch(function (error) {
        updateWarningModal({
            title: "Deployment Failed",
            warningText: error.message || "An error occurred while starting the container.",
            buttonText: "Close",
            onClose: function () {
                // Reset UI to normal state after modal is closed
                resetToNormalState(container);
            }
        });
    });
}

function resetToNormalState(container) {
    // Clear any existing timers
    if (statusIntervals[container]) {
        clearInterval(statusIntervals[container]);
        delete statusIntervals[container];
    }
    
    // Reset the UI to show the normal launch button
    const dockerContainer = CTFd.lib.$('#docker_container');
    const originalHTML = `
        <div class="description">Spin up your challenge container.</div>
        <div class="docker-control-panel">
            <div class="docker-launch-section">
                <button onclick="start_container('${container}');" class="docker-launch-btn">
                    Launch Instance
                </button>
            </div>
        </div>
    `;
    dockerContainer.html(originalHTML);
}

// Clean up all timers when the page/challenge is closed
window.addEventListener('beforeunload', function() {
    for (let container in statusIntervals) {
        if (statusIntervals[container]) {
            clearInterval(statusIntervals[container]);
            delete statusIntervals[container];
        }
    }
    if (window.autoKillCheck) {
        clearInterval(window.autoKillCheck);
        window.autoKillCheck = null;
    }
});

// Also clean up when navigating away from challenge (only clear auto-kill check, keep timers running)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Only clear the periodic auto-kill check to save resources
        // Keep container timers running even when tab is hidden
        if (window.autoKillCheck) {
            clearInterval(window.autoKillCheck);
            window.autoKillCheck = null;
        }
    } else {
        // When tab becomes visible again, restart the auto-kill check
        const containername = CTFd._internal.challenge.data.docker_image;
        if (containername && !window.autoKillCheck) {
            window.autoKillCheck = setInterval(() => {
                get_docker_status(containername);
            }, 30000);
        }
    }
});


function updateWarningModal({
    title , warningText, buttonText, onClose } = {}) {
    
    // Determine modal colors based on title
    let headerColor = '#10b981';
    let titleColor = '#ffffff';
    
    if (title.toLowerCase().includes('error')) {
        headerColor = '#dc2626'; // Red for errors
    } else if (title.toLowerCase().includes('success') || title.toLowerCase().includes('started')) {
        headerColor = '#10b981'; // Green for success
    } else if (title.toLowerCase().includes('attention')) {
        headerColor = '#f59e0b'; // Orange for warnings
        titleColor = '#1f2937'; // Dark text for better contrast on orange
    }
    
    const modalHTML = `
        <div id="warningModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; z-index:9999; background-color:rgba(0,0,0,0.6);">
          <div style="position:relative; margin:8% auto; width:420px; max-width:90%; background:var(--card-bg, #ffffff); border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.3); overflow:hidden; color:var(--text-primary, #212529); border: 1px solid var(--border-color, #dee2e6);">
            <div class="modal-header" style="padding:1.25rem; display:flex; justify-content:space-between; align-items:center; background:${headerColor}; color:${titleColor};">
              <h5 class="modal-title" style="margin:0; color:inherit; font-size:16px; font-weight:600;">${title}</h5>
              <button type="button" id="warningCloseBtn" style="border:none; background:none; font-size:1.5rem; line-height:1; cursor:pointer; color:inherit; opacity:0.8; padding:0; width:24px; height:24px; border-radius:4px; transition:opacity 0.2s ease;">&times;</button>
            </div>
            <div class="modal-body" style="padding:1.25rem; color:var(--text-primary, #212529); line-height:1.5; font-size:14px;">
              ${warningText}
            </div>
            <div class="modal-footer" style="padding:1rem 1.25rem; text-align:right; border-top:1px solid var(--border-color, #dee2e6); background:var(--card-bg, #ffffff);">
              <button type="button" class="btn btn-primary" id="warningOkBtn" style="background:${headerColor}; border-color:${headerColor}; padding:8px 16px; border-radius:4px; font-size:13px; font-weight:500;">${buttonText}</button>
            </div>
          </div>
        </div>
    `;
    CTFd.lib.$("#warningModalBody").html(modalHTML);

    // Show the modal
    CTFd.lib.$("#warningModal").show();

    // Close logic with callback
    const closeModal = () => {
        CTFd.lib.$("#warningModal").hide();
        if (typeof onClose === 'function') {
            onClose();  
        }
    };

    CTFd.lib.$("#warningCloseBtn").on("click", closeModal);
    CTFd.lib.$("#warningOkBtn").on("click", closeModal);
    
    // Close on backdrop click
    CTFd.lib.$("#warningModal").on("click", function(e) {
        if (e.target === this) {
            closeModal();
        }
    });
    
    // Close on escape key
    CTFd.lib.$(document).on("keydown.warningModal", function(e) {
        if (e.key === "Escape") {
            closeModal();
            CTFd.lib.$(document).off("keydown.warningModal");
        }
    });
}

// Simple toast notification with professional styling
function showToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        padding: 10px 16px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        margin-bottom: 8px;
        animation: slideIn 0.3s ease-out;
        pointer-events: auto;
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }
    }, 3000);
}

// In order to capture the flag submission, and remove the "Revert" and "Stop" buttons after solving a challenge
// We need to hook that call, and do this manually.
function checkForCorrectFlag() {
    const challengeWindow = document.querySelector('#challenge-window');
    if (!challengeWindow || getComputedStyle(challengeWindow).display === 'none') {
        clearInterval(checkInterval);
        checkInterval = null;
        return;
    }

    const notification = document.querySelector('.notification-row .alert');
    if (!notification) return;

    const strong = notification.querySelector('strong');
    if (!strong) return;

    const message = strong.textContent.trim();

    if (message.includes("Correct")) {
        get_docker_status(CTFd._internal.challenge.data.docker_image);
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

if (!checkInterval) {
    var checkInterval = setInterval(checkForCorrectFlag, 1500);
}