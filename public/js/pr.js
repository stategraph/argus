// PR Page JavaScript
// Handles polling, inline comments, and diff loading

(function() {
  'use strict';

  const config = window.ARGUS_CONFIG;
  if (!config) {
    console.error('ARGUS_CONFIG not found');
    return;
  }

  // State
  let pollingInterval = null;
  let lastKnownHeadSha = config.headSha;

  // DOM Elements
  const updatesBanner = document.getElementById('updates-banner');
  const reloadLink = document.getElementById('reload-link');
  const dismissBannerBtn = document.getElementById('dismiss-banner');
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  const currentHeadShaEl = document.getElementById('current-head-sha');
  const fetchedAtEl = document.getElementById('fetched-at');
  const diffContainer = document.getElementById('diff-container');
  const pollIntervalTextEl = document.getElementById('poll-interval-text');

  // Initialize
  init();

  function init() {
    // Restore state on page load
    restoreState();

    // Set up event listeners
    setupPolling();
    setupSidebarLinks();
    setupInlineComments();
    setupCommentControls();
    setupReplyButtons();
    setupFileReviewToggles();
    setupDiffControls();
    setupPerDirectoryControls();
    setupSyntaxToggle();

    // Auto-switch to Files tab for historical/cross-revision/explicit-current views
    if (config.isHistoricalView || config.isCrossRevisionView || config.isCurrentRevisionExplicit) {
      const filesTab = document.querySelector('.pr-tab[data-tab="files"]');
      if (filesTab) {
        filesTab.click();
      }
    }

    // Revision pill dropdowns
    setupRevisionDropdowns();

    // Dismiss banner
    if (dismissBannerBtn) {
      dismissBannerBtn.addEventListener('click', () => {
        updatesBanner.classList.add('hidden');
      });
    }

    // Check updates button
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', checkForUpdates);
    }

    // Reload link
    if (reloadLink) {
      reloadLink.href = window.location.href;
    }

    // Save state before form submissions
    document.querySelectorAll('form').forEach(form => {
      form.addEventListener('submit', saveStateBeforeSubmit);
    });
  }

  // Compare dropdown
  function setupRevisionDropdowns() {
    const toggle = document.querySelector('.compare-dropdown-toggle');
    const dropdown = document.querySelector('.compare-dropdown');
    if (!toggle || !dropdown) return;

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    // Close on outside click
    document.addEventListener('click', () => {
      if (dropdown) dropdown.style.display = 'none';
    });

    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  // Polling for updates
  function setupPolling() {
    if (config.isHistoricalView || config.isCrossRevisionView) {
      // Don't poll for updates when viewing historical/cross-revision
      if (pollIntervalTextEl) {
        pollIntervalTextEl.textContent = config.isCrossRevisionView ? 'Comparison view' : 'Historical view';
      }
      return;
    }
    if (config.pollIntervalMs > 0) {
      pollingInterval = setInterval(checkForUpdates, config.pollIntervalMs);
    } else if (pollIntervalTextEl) {
      pollIntervalTextEl.textContent = 'Auto-check disabled';
    }
  }

  async function checkForUpdates() {
    // Visual feedback
    if (checkUpdatesBtn) {
      checkUpdatesBtn.textContent = 'Checking...';
      checkUpdatesBtn.disabled = true;
    }

    try {
      const url = `/pr/${config.owner}/${config.repo}/${config.prNumber}/head`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn('Failed to check for updates:', response.status);
        if (checkUpdatesBtn) {
          checkUpdatesBtn.textContent = 'Check failed';
          setTimeout(() => {
            checkUpdatesBtn.textContent = 'Check for updates';
            checkUpdatesBtn.disabled = false;
          }, 2000);
        }
        return;
      }

      const data = await response.json();

      if (data.head_sha && data.head_sha !== lastKnownHeadSha) {
        showUpdatesBanner();
        if (checkUpdatesBtn) {
          checkUpdatesBtn.textContent = 'Updates available!';
        }
        if (pollIntervalTextEl) {
          pollIntervalTextEl.textContent = 'Updates available';
        }
        // Stop polling after update detected
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      } else {
        // No updates
        if (checkUpdatesBtn) {
          checkUpdatesBtn.textContent = 'Up to date';
          setTimeout(() => {
            checkUpdatesBtn.textContent = 'Check for updates';
            checkUpdatesBtn.disabled = false;
          }, 2000);
        }
      }
    } catch (err) {
      console.error('Error checking for updates:', err);
      if (checkUpdatesBtn) {
        checkUpdatesBtn.textContent = 'Check failed';
        setTimeout(() => {
          checkUpdatesBtn.textContent = 'Check for updates';
          checkUpdatesBtn.disabled = false;
        }, 2000);
      }
    }
  }

  function showUpdatesBanner() {
    if (updatesBanner) {
      updatesBanner.classList.remove('hidden');
    }
  }

  // Sidebar links
  function setupSidebarLinks() {
    const sidebarItems = document.querySelectorAll('.file-sidebar-item');

    sidebarItems.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();

        // Highlight file
        const files = diffContainer.querySelectorAll('.diff-file');
        files.forEach((f, i) => {
          f.classList.toggle('highlighted', i === index);
        });

        // Scroll to file
        const targetFile = files[index];
        if (targetFile) {
          // Ensure file is expanded (details element)
          targetFile.open = true;
          targetFile.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Update sidebar active state
        sidebarItems.forEach((sidebarItem, i) => {
          sidebarItem.classList.toggle('active', i === index);
        });
      });
    });
  }

  // Inline comments
  function setupInlineComments() {
    // Handle click on inline comment buttons
    diffContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.line-comment-btn');
      if (!btn) return;

      e.preventDefault(); // Prevent scroll to anchor

      const formId = btn.getAttribute('href').substring(1);
      const formRow = document.getElementById(formId);
      if (formRow) {
        // Hide any other open forms
        document.querySelectorAll('.inline-comment-form-row.visible').forEach(row => {
          row.classList.remove('visible');
        });

        // Show this form
        formRow.classList.add('visible');

        // Focus textarea
        const textarea = formRow.querySelector('textarea');
        if (textarea) {
          textarea.focus();
        }
      }
    });

    // Handle cancel buttons
    diffContainer.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('.comment-form-close, .inline-comment-form .btn-secondary');
      if (!cancelBtn) return;

      e.preventDefault();

      // Find and hide the form row
      const formRow = cancelBtn.closest('.inline-comment-form-row');
      if (formRow) {
        formRow.classList.remove('visible');
        // Clear the textarea
        const textarea = formRow.querySelector('textarea');
        if (textarea) {
          textarea.value = '';
        }
      }

      // Also clear hash if present
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
  }

  // Expand/collapse all comments
  function setupCommentControls() {
    const expandAllBtn = document.getElementById('expand-all-comments');
    const collapseAllBtn = document.getElementById('collapse-all-comments');

    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const commentsList = document.querySelector('.comments-list');
        if (commentsList) {
          const allComments = commentsList.querySelectorAll('details.comment, details.review');
          allComments.forEach(comment => {
            comment.open = true;
          });
        }
      });
    }

    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const commentsList = document.querySelector('.comments-list');
        if (commentsList) {
          const allComments = commentsList.querySelectorAll('details.comment, details.review');
          allComments.forEach(comment => {
            comment.open = false;
          });
        }
      });
    }
  }

  // Reply to comments
  function setupReplyButtons() {
    const replyButtons = document.querySelectorAll('.reply-to-comment');
    const commentForm = document.querySelector('.pr-comment-form textarea[name="body"]');

    if (!commentForm) return;

    replyButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const author = button.getAttribute('data-author');
        const body = button.getAttribute('data-body');
        const shouldQuote = button.getAttribute('data-quote') === 'true';

        let replyText;

        if (shouldQuote && body) {
          // Create quoted reply
          const quotedLines = body.split('\\n').map(line => `> ${line}`).join('\n');
          replyText = `@${author}\n\n${quotedLines}\n\n`;
        } else {
          // Simple mention reply
          replyText = `@${author} `;
        }

        // Set the form value and focus
        commentForm.value = replyText;
        commentForm.focus();

        // Scroll to the comment form
        commentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  // File review toggles
  function setupFileReviewToggles() {
    if (!diffContainer) return;

    diffContainer.addEventListener('change', async (e) => {
      const checkbox = e.target.closest('.file-reviewed-toggle');
      if (!checkbox) return;

      const path = checkbox.dataset.path;

      try {
        const response = await fetch(
          `/pr/${config.owner}/${config.repo}/${config.prNumber}/file-review`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: path, head_sha: config.headSha })
          }
        );

        const { reviewed } = await response.json();
        checkbox.checked = reviewed;

        const fileEl = checkbox.closest('.diff-file');
        if (fileEl) {
          fileEl.classList.toggle('file-reviewed', reviewed);
          // Collapse diff when marked as reviewed, expand when unmarked
          fileEl.open = !reviewed;
          // Scroll collapsed file into view so the user can see it and the next file
          if (reviewed) {
            fileEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }

        // Update review progress count
        updateReviewProgress();
      } catch (err) {
        console.error('Failed to toggle review:', err);
        checkbox.checked = !checkbox.checked; // Revert
      }
    });
  }

  function updateReviewProgress() {
    const progressEl = document.getElementById('review-progress-count');
    if (!progressEl) return;

    const totalFiles = document.querySelectorAll('.diff-file').length;
    const reviewedFiles = document.querySelectorAll('.file-reviewed-toggle:checked').length;
    progressEl.textContent = `${reviewedFiles} / ${totalFiles}`;
  }

  // Diff controls
  function setupDiffControls() {
    const expandBtn = document.getElementById('expand-all-diffs');
    const collapseBtn = document.getElementById('collapse-all-diffs');

    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        // Expand both directories and files
        document.querySelectorAll('.diff-directory, .diff-file').forEach(el => {
          el.open = true;
        });
      });
    }

    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        // Collapse both directories and files
        document.querySelectorAll('.diff-directory, .diff-file').forEach(el => {
          el.open = false;
        });
      });
    }
  }

  // Per-directory controls
  function setupPerDirectoryControls() {
    if (!diffContainer) return;

    diffContainer.addEventListener('click', (e) => {
      const target = e.target;

      // Expand all in directory
      if (target.classList.contains('dir-expand-all')) {
        e.preventDefault();
        e.stopPropagation();

        const directory = target.closest('.diff-directory');
        if (directory) {
          const children = directory.querySelector('.directory-children');
          if (children) {
            children.querySelectorAll('.diff-directory, .diff-file').forEach(el => {
              el.open = true;
            });
          }
        }
      }

      // Collapse all in directory
      if (target.classList.contains('dir-collapse-all')) {
        e.preventDefault();
        e.stopPropagation();

        const directory = target.closest('.diff-directory');
        if (directory) {
          const children = directory.querySelector('.directory-children');
          if (children) {
            children.querySelectorAll('.diff-directory, .diff-file').forEach(el => {
              el.open = false;
            });
          }
        }
      }
    });
  }

  // Syntax highlighting toggle
  function setupSyntaxToggle() {
    if (!diffContainer) return;

    diffContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('.syntax-toggle');
      if (!btn) return;

      const currentState = btn.textContent.trim().includes('ON');
      const newState = !currentState;

      try {
        const response = await fetch(
          `/pr/${config.owner}/${config.repo}/${config.prNumber}/syntax-toggle`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newState })
          }
        );

        if (response.ok) {
          // Reload page to apply new highlighting state
          window.location.reload();
        }
      } catch (err) {
        console.error('Failed to toggle syntax highlighting:', err);
      }
    });
  }

  // State management for preserving context after form submissions
  function captureState() {
    const activeTab = document.querySelector('.pr-tab.active')?.dataset.tab || 'conversation';
    return { tab: activeTab };
  }

  function saveStateBeforeSubmit() {
    const state = captureState();
    const stateKey = `pr-state-${config.owner}/${config.repo}/${config.prNumber}`;
    sessionStorage.setItem(stateKey, JSON.stringify(state));
  }

  function restoreState() {
    const stateKey = `pr-state-${config.owner}/${config.repo}/${config.prNumber}`;
    const stateJson = sessionStorage.getItem(stateKey);
    if (!stateJson) return;

    try {
      const state = JSON.parse(stateJson);

      // Restore tab only
      if (state.tab && state.tab !== 'conversation') {
        const tabBtn = document.querySelector(`.pr-tab[data-tab="${state.tab}"]`);
        if (tabBtn) {
          tabBtn.click();
        }
      }

      sessionStorage.removeItem(stateKey);
    } catch (e) {
      console.error('Failed to restore state:', e);
    }
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  });
})();
