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
    setupFileDeepLinks();
    setupGoToFileModal();

    // Auto-switch to Files tab for historical/cross-revision/explicit-current views
    // (only if no tab is explicitly set in the URL)
    if (!new URL(window.location).searchParams.has('tab')) {
      if (config.isHistoricalView || config.isCrossRevisionView || config.isCurrentRevisionExplicit) {
        const filesTab = document.querySelector('.pr-tab[data-tab="files"]');
        if (filesTab) {
          filesTab.click();
        }
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

    sidebarItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();

        const fileId = item.dataset.fileId;

        // Highlight file
        const files = diffContainer.querySelectorAll('.diff-file');
        files.forEach((f) => {
          f.classList.toggle('highlighted', f.dataset.fileId === fileId);
        });

        // Scroll to file
        const targetFile = diffContainer.querySelector(`.diff-file[data-file-id="${fileId}"]`);
        if (targetFile) {
          // Ensure file is expanded (details element)
          targetFile.open = true;
          targetFile.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Update sidebar active state
        sidebarItems.forEach((sidebarItem) => {
          sidebarItem.classList.toggle('active', sidebarItem.dataset.fileId === fileId);
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
    const panel = document.getElementById('review-progress-panel');
    if (!panel) return;

    const allFiles = document.querySelectorAll('.diff-file');
    const totalFiles = allFiles.length;
    const reviewedFileCount = document.querySelectorAll('.file-reviewed-toggle:checked').length;

    let totalLines = 0;
    let reviewedLines = 0;
    allFiles.forEach(el => {
      const lines = (parseInt(el.dataset.additions) || 0) + (parseInt(el.dataset.deletions) || 0);
      totalLines += lines;
      const checkbox = el.querySelector('.file-reviewed-toggle');
      if (checkbox && checkbox.checked) {
        reviewedLines += lines;
      }
    });

    const percent = totalLines > 0 ? Math.round(reviewedLines / totalLines * 100) : 0;

    const filesEl = document.getElementById('review-progress-files');
    const linesEl = document.getElementById('review-progress-lines');
    const percentEl = document.getElementById('review-progress-percent');
    const barEl = document.getElementById('review-progress-bar');

    if (filesEl) filesEl.textContent = reviewedFileCount;
    if (linesEl) linesEl.textContent = reviewedLines;
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) barEl.style.width = `${percent}%`;
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

  // File deep links
  function setupFileDeepLinks() {
    // Handle clicking file deep links: update URL tab param and ensure file is expanded
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.file-deep-link');
      if (!link) return;

      e.preventDefault();
      const hash = link.getAttribute('href');
      const url = new URL(window.location);
      url.searchParams.set('tab', 'files');
      url.hash = hash;
      history.replaceState(null, '', url);

      // Ensure the Files tab is active
      const filesTab = document.querySelector('.pr-tab[data-tab="files"]');
      if (filesTab && !filesTab.classList.contains('active')) {
        filesTab.click();
      }

      // Expand and scroll to the target file
      const target = document.querySelector(hash);
      if (target) {
        const details = target.closest('details.diff-file');
        if (details) details.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // On page load, if there's a hash, expand ancestors and scroll to it
    const hash = window.location.hash;
    if (hash && (hash.startsWith('#file-') || hash.startsWith('#comment-'))) {
      const target = document.querySelector(hash);
      if (target) {
        const details = target.closest('details.diff-file');
        if (details) details.open = true;
        // Also expand parent directories
        let parent = details?.parentElement?.closest('details.diff-directory');
        while (parent) {
          parent.open = true;
          parent = parent.parentElement?.closest('details.diff-directory');
        }
        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  }

  // Go to file modal
  function setupGoToFileModal() {
    const overlay = document.getElementById('goto-file-overlay');
    const modal = document.getElementById('goto-file-modal');
    const input = document.getElementById('goto-file-input');
    const resultsList = document.getElementById('goto-file-results');
    if (!overlay || !modal || !input || !resultsList) return;

    let selectedIndex = 0;
    let filteredFiles = [];

    function getFiles() {
      const els = document.querySelectorAll('.diff-file');
      const files = [];
      els.forEach(el => {
        const path = el.dataset.path;
        const fileId = el.dataset.fileId;
        if (path && fileId) files.push({ path, fileId, el });
      });
      return files;
    }

    function openModal() {
      const allFiles = getFiles();
      filteredFiles = allFiles;
      selectedIndex = 0;
      input.value = '';
      renderResults();
      overlay.classList.add('active');
      modal.classList.add('active');
      input.focus();
    }

    function closeModal() {
      overlay.classList.remove('active');
      modal.classList.remove('active');
    }

    function renderResults() {
      resultsList.innerHTML = '';
      filteredFiles.forEach((file, i) => {
        const li = document.createElement('li');
        li.className = 'goto-file-result' + (i === selectedIndex ? ' selected' : '');
        const lastSlash = file.path.lastIndexOf('/');
        if (lastSlash >= 0) {
          const dir = file.path.substring(0, lastSlash + 1);
          const name = file.path.substring(lastSlash + 1);
          li.innerHTML = '<span class="goto-file-dir">' + escapeHtml(dir) + '</span>' + escapeHtml(name);
        } else {
          li.textContent = file.path;
        }
        li.addEventListener('click', () => navigateToFile(file));
        resultsList.appendChild(li);
      });
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function filterFiles(query) {
      const allFiles = getFiles();
      if (!query.trim()) {
        filteredFiles = allFiles;
      } else {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        filteredFiles = allFiles.filter(f => {
          const lower = f.path.toLowerCase();
          return tokens.every(t => lower.includes(t));
        });
      }
      selectedIndex = 0;
      renderResults();
    }

    function navigateToFile(file) {
      closeModal();

      // Switch to Files tab
      const filesTab = document.querySelector('.pr-tab[data-tab="files"]');
      if (filesTab && !filesTab.classList.contains('active')) {
        filesTab.click();
      }

      // Expand parent directories
      let parent = file.el.parentElement?.closest('details.diff-directory');
      while (parent) {
        parent.open = true;
        parent = parent.parentElement?.closest('details.diff-directory');
      }

      // Expand file
      file.el.open = true;
      file.el.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Update hash
      const url = new URL(window.location);
      url.searchParams.set('tab', 'files');
      url.hash = '#file-' + file.fileId;
      history.replaceState(null, '', url);
    }

    input.addEventListener('input', () => filterFiles(input.value));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedIndex < filteredFiles.length - 1) {
          selectedIndex++;
          renderResults();
          const sel = resultsList.querySelector('.selected');
          if (sel) sel.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedIndex > 0) {
          selectedIndex--;
          renderResults();
          const sel = resultsList.querySelector('.selected');
          if (sel) sel.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredFiles[selectedIndex]) {
          navigateToFile(filteredFiles[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    });

    overlay.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'g' && !modal.classList.contains('active')) {
        const tag = document.activeElement?.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        // Don't trigger if review form is open
        const reviewForm = document.getElementById('review-form');
        if (reviewForm && reviewForm.classList.contains('active')) return;
        e.preventDefault();
        openModal();
      }
    });
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  });
})();
