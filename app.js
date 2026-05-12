// ===== CuongMC Music Player =====
(function () {
    'use strict';

    // --- State ---
    const state = {
        queue: [],           // [{id, title, thumb}]
        currentIndex: -1,
        isPlaying: false,
        shuffle: false,
        repeat: 'none',      // none | one | all
        volume: 80,
        player: null,
        ready: false,
        progressTimer: null,
        silentAudio: null, // For background keep-alive
        audioCtx: null,    // For iOS keep-alive
        isUserPaused: false, // Distinguish between user and system pause
    };

    // --- DOM Cache ---
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    const dom = {
        tabBtns: $$('.tab-btn'),
        tabContents: $$('.tab-content'),
        inputUrl: $('#input-url'),
        inputPlaylist: $('#input-playlist'),
        inputBulk: $('#input-bulk'),
        btnAddSingle: $('#btn-add-single'),
        btnAddPlaylist: $('#btn-add-playlist'),
        btnAddBulk: $('#btn-add-bulk'),
        btnPlay: $('#btn-play'),
        btnPrev: $('#btn-prev'),
        btnNext: $('#btn-next'),
        btnShuffle: $('#btn-shuffle'),
        btnRepeat: $('#btn-repeat'),
        btnMute: $('#btn-mute'),
        btnToggleVideo: $('#btn-toggle-video'),
        btnSaveQueue: $('#btn-save-queue'),
        btnClearQueue: $('#btn-clear-queue'),
        iconPlay: $('#icon-play'),
        iconPause: $('#icon-pause'),
        iconVolume: $('#icon-volume'),
        iconMute: $('#icon-mute'),
        volumeSlider: $('#volume-slider'),
        progressBar: $('#progress-bar'),
        progressFill: $('#progress-fill'),
        progressThumb: $('#progress-thumb'),
        timeCurrent: $('#time-current'),
        timeTotal: $('#time-total'),
        trackTitle: $('#track-title'),
        trackArtist: $('#track-artist'),
        queueList: $('#queue-list'),
        queueEmpty: $('#queue-empty'),
        queueCount: $('#queue-count'),
        playerPlaceholder: $('#player-placeholder'),
        savedPlaylists: $('#saved-playlists'),
        savedList: $('#saved-list'),
    };

    // --- Background Keep-Alive ---
    function initSilentAudio() {
        if (state.silentAudio) return;
        // 10-second silent MP3 base64 (more robust for iOS)
        const silentSrc = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGFtZTMuOThyA7VvAAAAAAAAAAAAAAA//uQZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZ28AAAAPAAAAAgAAAHMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        state.silentAudio = new Audio(silentSrc);
        state.silentAudio.loop = true;
        state.silentAudio.volume = 0.05; // Slightly higher than 0.01 for iOS to recognize it
        
        // Also init AudioContext for iOS
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                state.audioCtx = new AudioContext();
            }
        } catch(e) {}
    }

    function startBackgroundKeepAlive() {
        if (!state.silentAudio) initSilentAudio();
        
        // Resume AudioContext
        if (state.audioCtx && state.audioCtx.state === 'suspended') {
            state.audioCtx.resume();
        }

        state.silentAudio.play().catch(() => {
            // Fallback for user interaction requirement
            document.addEventListener('click', () => {
                state.silentAudio.play();
                if (state.audioCtx) state.audioCtx.resume();
            }, { once: true });
        });
    }

    function stopBackgroundKeepAlive() {
        if (state.silentAudio) {
            state.silentAudio.pause();
        }
    }

    // --- Media Session API ---
    function updateMediaSession() {
        if (!('mediaSession' in navigator)) return;

        const track = state.queue[state.currentIndex];
        if (!track) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: 'CuongMC Music',
            album: 'YouTube Player',
            artwork: [
                { src: `https://img.youtube.com/vi/${track.id}/default.jpg`, sizes: '96x96', type: 'image/jpeg' },
                { src: `https://img.youtube.com/vi/${track.id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
                { src: `https://img.youtube.com/vi/${track.id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
            ]
        });

        // Set action handlers
        const actions = {
            play: () => {
                state.isUserPaused = false;
                state.player.playVideo();
            },
            pause: () => {
                state.isUserPaused = true;
                state.player.pauseVideo();
            },
            previoustrack: () => playPrev(),
            nexttrack: () => playNext(),
            seekbackward: (details) => {
                const skipTime = details.seekOffset || 10;
                state.player.seekTo(Math.max(state.player.getCurrentTime() - skipTime, 0), true);
            },
            seekforward: (details) => {
                const skipTime = details.seekOffset || 10;
                state.player.seekTo(Math.min(state.player.getCurrentTime() + skipTime, state.player.getDuration()), true);
            },
            seekto: (details) => {
                if (details.fastSeek && 'fastSeek' in state.player) {
                    state.player.seekTo(details.seekTime, true);
                    return;
                }
                state.player.seekTo(details.seekTime, true);
            }
        };

        for (const [action, handler] of Object.entries(actions)) {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (error) {
                // Action not supported
            }
        }
    }

    function updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';

        if (state.isPlaying) {
            startBackgroundKeepAlive();
        } else {
            // Keep silent audio playing for a bit to maintain focus on mobile
            // stopBackgroundKeepAlive();
        }
    }

    // --- YouTube IFrame API ---
    function loadYTApi() {
        if (window.YT && window.YT.Player) { initPlayer(); return; }
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = function () {
        initPlayer();
    };

    function initPlayer() {
        state.player = new YT.Player('yt-player', {
            height: '100%', width: '100%',
            playerVars: {
                autoplay: 0, controls: 0, modestbranding: 1,
                rel: 0, showinfo: 0, fs: 0, iv_load_policy: 3,
                playsinline: 1, origin: location.origin,
            },
            events: {
                onReady: onPlayerReady,
                onStateChange: onPlayerStateChange,
                onError: onPlayerError,
            },
        });
    }

    function onPlayerReady() {
        state.ready = true;
        state.player.setVolume(state.volume);
        if (state.queue.length > 0 && state.currentIndex >= 0) {
            loadTrack(state.currentIndex, false);
        }
    }

    function onPlayerStateChange(e) {
        if (e.data === YT.PlayerState.PLAYING) {
            state.isPlaying = true;
            updatePlayBtn();
            startProgressTimer();
            updateMediaSessionPlaybackState();
        } else if (e.data === YT.PlayerState.PAUSED) {
            // iPhone/iOS logic: if it pauses in background, it's likely system-forced
            if (document.hidden && !state.isUserPaused) {
                // Wait a bit and try to resume
                setTimeout(() => {
                    if (!state.isUserPaused && state.player && state.player.playVideo) {
                        state.player.playVideo();
                    }
                }, 300);
                return;
            }
            state.isPlaying = false;
            updatePlayBtn();
            stopProgressTimer();
            updateMediaSessionPlaybackState();
        } else if (e.data === YT.PlayerState.ENDED) {
            handleTrackEnd();
        }
    }

    function onPlayerError(e) {
        console.warn('YT Error:', e.data);
        toast('Không thể phát video này, chuyển bài...');
        setTimeout(() => playNext(), 1500);
    }

    // --- URL Parsing ---
    function extractVideoId(url) {
        url = url.trim();
        let m;
        m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/);
        if (m) return m[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
        return null;
    }

    function extractPlaylistId(url) {
        const m = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        return m ? m[1] : null;
    }

    // --- Fetch Video Info via noembed ---
    async function fetchVideoTitle(videoId) {
        try {
            const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
            const data = await res.json();
            return data.title || `Video ${videoId}`;
        } catch {
            return `Video ${videoId}`;
        }
    }

    // --- Queue Management ---
    function addToQueue(videoId, title) {
        if (state.queue.some(t => t.id === videoId)) {
            toast('Bài hát đã có trong danh sách!');
            return false;
        }
        const thumb = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        state.queue.push({ id: videoId, title, thumb });
        renderQueue();
        if (state.queue.length === 1) {
            state.currentIndex = 0;
            loadTrack(0, false);
        }
        return true;
    }

    function removeFromQueue(index) {
        if (index < 0 || index >= state.queue.length) return;
        const wasPlaying = index === state.currentIndex;
        state.queue.splice(index, 1);
        if (state.queue.length === 0) {
            state.currentIndex = -1;
            resetPlayer();
        } else if (wasPlaying) {
            state.currentIndex = Math.min(index, state.queue.length - 1);
            loadTrack(state.currentIndex, state.isPlaying);
        } else if (index < state.currentIndex) {
            state.currentIndex--;
        }
        renderQueue();
    }

    function clearQueue() {
        state.queue = [];
        state.currentIndex = -1;
        resetPlayer();
        renderQueue();
    }

    // --- Player Controls ---
    function loadTrack(index, autoplay) {
        if (!state.ready || index < 0 || index >= state.queue.length) return;
        state.currentIndex = index;
        const track = state.queue[index];
        dom.trackTitle.textContent = track.title;
        dom.trackArtist.textContent = `Đang phát từ YouTube`;
        dom.playerPlaceholder.style.display = 'none';
        dom.btnToggleVideo.style.display = 'flex';
        document.title = `${track.title} - CuongMC Music`;
        if (autoplay) {
            state.player.loadVideoById(track.id);
        } else {
            state.player.cueVideoById(track.id);
        }
        renderQueue();
        updateProgressDisplay();
        updateMediaSession();
    }

    function togglePlay() {
        if (!state.ready) return;
        if (state.currentIndex < 0 && state.queue.length > 0) {
            state.currentIndex = 0;
            loadTrack(0, true);
            return;
        }
        if (state.isPlaying) {
            state.isUserPaused = true;
            state.player.pauseVideo();
        } else {
            state.isUserPaused = false;
            state.player.playVideo();
        }
    }

    function playNext() {
        if (state.queue.length === 0) return;
        let next;
        if (state.shuffle) {
            next = Math.floor(Math.random() * state.queue.length);
            if (state.queue.length > 1) while (next === state.currentIndex) next = Math.floor(Math.random() * state.queue.length);
        } else {
            next = state.currentIndex + 1;
            if (next >= state.queue.length) {
                if (state.repeat === 'all') next = 0;
                else { state.isPlaying = false; updatePlayBtn(); return; }
            }
        }
        loadTrack(next, true);
    }

    function playPrev() {
        if (state.queue.length === 0) return;
        // If more than 3 seconds in, restart current
        try {
            if (state.player.getCurrentTime && state.player.getCurrentTime() > 3) {
                state.player.seekTo(0, true);
                return;
            }
        } catch (e) { }
        let prev = state.currentIndex - 1;
        if (prev < 0) prev = state.repeat === 'all' ? state.queue.length - 1 : 0;
        loadTrack(prev, true);
    }

    function handleTrackEnd() {
        stopProgressTimer();
        if (state.repeat === 'one') {
            state.player.seekTo(0, true);
            state.player.playVideo();
        } else {
            playNext();
        }
    }

    function resetPlayer() {
        if (state.player && state.ready) {
            try { state.player.stopVideo(); } catch (e) { }
        }
        state.isPlaying = false;
        updatePlayBtn();
        stopProgressTimer();
        dom.trackTitle.textContent = 'Chưa có bài hát';
        dom.trackArtist.textContent = 'Thêm link YouTube để phát nhạc';
        dom.playerPlaceholder.style.display = 'flex';
        dom.btnToggleVideo.style.display = 'none';
        dom.progressFill.style.width = '0%';
        dom.progressThumb.style.left = '0%';
        dom.timeCurrent.textContent = '0:00';
        dom.timeTotal.textContent = '0:00';
        document.title = 'CuongMC Music 🎵';
    }

    // --- UI Updates ---
    function updatePlayBtn() {
        dom.iconPlay.style.display = state.isPlaying ? 'none' : 'block';
        dom.iconPause.style.display = state.isPlaying ? 'block' : 'none';
    }

    function formatTime(s) {
        s = Math.floor(s || 0);
        const m = Math.floor(s / 60);
        return m + ':' + String(s % 60).padStart(2, '0');
    }

    function updateProgressDisplay() {
        if (!state.ready || !state.player.getDuration) return;
        const dur = state.player.getDuration() || 0;
        const cur = state.player.getCurrentTime() || 0;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        dom.progressFill.style.width = pct + '%';
        dom.progressThumb.style.left = pct + '%';
        dom.timeCurrent.textContent = formatTime(cur);
        dom.timeTotal.textContent = formatTime(dur);
    }

    function startProgressTimer() {
        stopProgressTimer();
        state.progressTimer = setInterval(updateProgressDisplay, 500);
    }

    function stopProgressTimer() {
        if (state.progressTimer) { clearInterval(state.progressTimer); state.progressTimer = null; }
    }

    // --- Render Queue ---
    function renderQueue() {
        dom.queueCount.textContent = state.queue.length + ' bài';
        if (state.queue.length === 0) {
            dom.queueList.innerHTML = '';
            dom.queueList.appendChild(dom.queueEmpty);
            dom.queueEmpty.style.display = 'flex';
            return;
        }
        dom.queueEmpty.style.display = 'none';
        const frag = document.createDocumentFragment();
        state.queue.forEach((track, i) => {
            const el = document.createElement('div');
            el.className = 'queue-item' + (i === state.currentIndex ? ' active' : '');
            el.innerHTML = `
                <span class="queue-item-num">${i === state.currentIndex
                    ? '<span class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>'
                    : (i + 1)}</span>
                <div class="queue-item-thumb"><img src="${track.thumb}" alt="" loading="lazy"></div>
                <div class="queue-item-info">
                    <div class="queue-item-title">${escHtml(track.title)}</div>
                </div>
                <button class="queue-item-remove" data-index="${i}" title="Xóa">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>`;
            el.addEventListener('click', (e) => {
                if (e.target.closest('.queue-item-remove')) return;
                loadTrack(i, true);
            });
            el.querySelector('.queue-item-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromQueue(i);
            });
            frag.appendChild(el);
        });
        dom.queueList.innerHTML = '';
        dom.queueList.appendChild(frag);
        saveQueueToStorage();
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Toast ---
    let toastTimeout;
    function toast(msg) {
        let el = document.querySelector('.toast');
        if (!el) {
            el = document.createElement('div');
            el.className = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => el.classList.remove('show'), 2500);
    }

    // --- Add Handlers ---
    async function handleAddSingle() {
        const url = dom.inputUrl.value.trim();
        if (!url) { toast('Vui lòng nhập link YouTube!'); return; }
        const id = extractVideoId(url);
        if (!id) { toast('Link YouTube không hợp lệ!'); return; }
        dom.btnAddSingle.disabled = true;
        dom.btnAddSingle.textContent = 'Đang thêm...';
        const title = await fetchVideoTitle(id);
        addToQueue(id, title);
        dom.inputUrl.value = '';
        dom.btnAddSingle.disabled = false;
        dom.btnAddSingle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Thêm';
        toast('Đã thêm bài hát!');
    }

    async function handleAddPlaylist() {
        const url = dom.inputPlaylist.value.trim();
        if (!url) { toast('Vui lòng nhập link playlist!'); return; }
        const plId = extractPlaylistId(url);
        // Also check if it's a single video from a playlist link
        const vidId = extractVideoId(url);
        if (!plId && !vidId) { toast('Link playlist không hợp lệ!'); return; }

        dom.btnAddPlaylist.disabled = true;
        dom.btnAddPlaylist.textContent = 'Đang tải...';

        if (plId) {
            // Use YouTube's oembed + load playlist via player
            // We'll load individual videos from playlist using the IFrame API
            try {
                // Load playlist through a temporary player approach
                await loadPlaylistVideos(plId);
                toast('Đã tải playlist!');
            } catch (err) {
                toast('Không thể tải playlist. Thử lại!');
            }
        } else if (vidId) {
            const title = await fetchVideoTitle(vidId);
            addToQueue(vidId, title);
            toast('Đã thêm bài hát!');
        }

        dom.inputPlaylist.value = '';
        dom.btnAddPlaylist.disabled = false;
        dom.btnAddPlaylist.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg> Tải Playlist';
    }

    async function loadPlaylistVideos(playlistId) {
        // Use a hidden player to get playlist items
        return new Promise((resolve, reject) => {
            // Create temp container
            const tempDiv = document.createElement('div');
            tempDiv.id = 'temp-pl-player';
            tempDiv.style.display = 'none';
            document.body.appendChild(tempDiv);

            const tempPlayer = new YT.Player('temp-pl-player', {
                height: '1', width: '1',
                playerVars: { listType: 'playlist', list: playlistId },
                events: {
                    onReady: async function (e) {
                        try {
                            const playlist = e.target.getPlaylist();
                            if (playlist && playlist.length > 0) {
                                for (const vid of playlist) {
                                    const title = await fetchVideoTitle(vid);
                                    addToQueue(vid, title);
                                }
                            }
                        } catch (err) {
                            console.warn('Playlist load error:', err);
                        }
                        tempPlayer.destroy();
                        tempDiv.remove();
                        resolve();
                    },
                    onError: function () {
                        tempPlayer.destroy();
                        tempDiv.remove();
                        reject();
                    }
                }
            });

            // Timeout fallback
            setTimeout(() => {
                try { tempPlayer.destroy(); tempDiv.remove(); } catch (e) { }
                resolve();
            }, 15000);
        });
    }

    async function handleAddBulk() {
        const text = dom.inputBulk.value.trim();
        if (!text) { toast('Vui lòng nhập danh sách link!'); return; }
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        dom.btnAddBulk.disabled = true;
        dom.btnAddBulk.textContent = 'Đang thêm...';
        let count = 0;
        for (const line of lines) {
            const id = extractVideoId(line);
            if (id) {
                const title = await fetchVideoTitle(id);
                if (addToQueue(id, title)) count++;
            }
        }
        dom.inputBulk.value = '';
        dom.btnAddBulk.disabled = false;
        dom.btnAddBulk.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Thêm tất cả';
        toast(`Đã thêm ${count} bài hát!`);
    }

    // --- Local Storage ---
    function saveQueueToStorage() {
        try {
            localStorage.setItem('cuongmc_queue', JSON.stringify(state.queue));
            localStorage.setItem('cuongmc_index', state.currentIndex);
        } catch (e) { }
    }

    function loadQueueFromStorage() {
        try {
            const q = JSON.parse(localStorage.getItem('cuongmc_queue'));
            const idx = parseInt(localStorage.getItem('cuongmc_index'), 10);
            if (q && q.length > 0) {
                state.queue = q;
                state.currentIndex = isNaN(idx) ? 0 : Math.min(idx, q.length - 1);
                renderQueue();
            }
        } catch (e) { }
    }

    // --- Named Playlists ---
    function getSavedPlaylists() {
        try { return JSON.parse(localStorage.getItem('cuongmc_saved_playlists')) || []; } catch { return []; }
    }

    function savePlaylists(list) {
        localStorage.setItem('cuongmc_saved_playlists', JSON.stringify(list));
    }

    function handleSaveQueue() {
        if (state.queue.length === 0) { toast('Danh sách trống!'); return; }
        const name = prompt('Đặt tên cho danh sách:', 'Danh sách ' + new Date().toLocaleDateString('vi-VN'));
        if (!name) return;
        const playlists = getSavedPlaylists();
        playlists.push({ name, tracks: [...state.queue], date: Date.now() });
        savePlaylists(playlists);
        renderSavedPlaylists();
        toast('Đã lưu danh sách "' + name + '"!');
    }

    function renderSavedPlaylists() {
        const playlists = getSavedPlaylists();
        if (playlists.length === 0) {
            dom.savedPlaylists.style.display = 'none';
            return;
        }
        dom.savedPlaylists.style.display = 'block';
        dom.savedList.innerHTML = '';
        playlists.forEach((pl, i) => {
            const el = document.createElement('div');
            el.className = 'saved-item';
            el.innerHTML = `<span>🎵 ${escHtml(pl.name)} (${pl.tracks.length})</span>
                <button class="saved-item-del" data-idx="${i}" title="Xóa">✕</button>`;
            el.addEventListener('click', (e) => {
                if (e.target.closest('.saved-item-del')) {
                    const lists = getSavedPlaylists();
                    lists.splice(i, 1);
                    savePlaylists(lists);
                    renderSavedPlaylists();
                    toast('Đã xóa danh sách!');
                    return;
                }
                // Load playlist
                state.queue = [...pl.tracks];
                state.currentIndex = 0;
                renderQueue();
                if (state.ready) loadTrack(0, false);
                toast('Đã tải "' + pl.name + '"!');
            });
            dom.savedList.appendChild(el);
        });
    }

    // --- Progress Seek ---
    function handleProgressClick(e) {
        if (!state.ready || state.currentIndex < 0) return;
        const rect = dom.progressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const dur = state.player.getDuration() || 0;
        state.player.seekTo(pct * dur, true);
        updateProgressDisplay();
    }

    // --- Event Binding ---
    function bindEvents() {
        // Tabs
        dom.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                dom.tabBtns.forEach(b => b.classList.remove('active'));
                dom.tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                $(`#content-${btn.dataset.tab}`).classList.add('active');
            });
        });

        // Add buttons
        dom.btnAddSingle.addEventListener('click', handleAddSingle);
        dom.inputUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddSingle(); });
        dom.btnAddPlaylist.addEventListener('click', handleAddPlaylist);
        dom.inputPlaylist.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddPlaylist(); });
        dom.btnAddBulk.addEventListener('click', handleAddBulk);

        // Player controls
        dom.btnPlay.addEventListener('click', togglePlay);
        dom.btnNext.addEventListener('click', playNext);
        dom.btnPrev.addEventListener('click', playPrev);

        dom.btnShuffle.addEventListener('click', () => {
            state.shuffle = !state.shuffle;
            dom.btnShuffle.classList.toggle('active', state.shuffle);
            toast(state.shuffle ? 'Phát ngẫu nhiên: BẬT' : 'Phát ngẫu nhiên: TẮT');
        });

        dom.btnRepeat.addEventListener('click', () => {
            const modes = ['none', 'all', 'one'];
            const cur = modes.indexOf(state.repeat);
            state.repeat = modes[(cur + 1) % 3];
            dom.btnRepeat.classList.toggle('active', state.repeat !== 'none');
            const labels = { none: 'Không lặp', all: 'Lặp tất cả', one: 'Lặp một bài' };
            toast('Lặp lại: ' + labels[state.repeat]);
            // Show "1" indicator for repeat one
            if (state.repeat === 'one') {
                dom.btnRepeat.style.position = 'relative';
                if (!dom.btnRepeat.querySelector('.repeat-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'repeat-badge';
                    badge.textContent = '1';
                    badge.style.cssText = 'position:absolute;top:4px;right:4px;font-size:9px;font-weight:700;color:var(--accent-1);';
                    dom.btnRepeat.appendChild(badge);
                }
            } else {
                const badge = dom.btnRepeat.querySelector('.repeat-badge');
                if (badge) badge.remove();
            }
        });

        // Volume
        dom.volumeSlider.addEventListener('input', () => {
            state.volume = parseInt(dom.volumeSlider.value, 10);
            if (state.ready) state.player.setVolume(state.volume);
            updateVolumeIcon();
        });

        dom.btnMute.addEventListener('click', () => {
            if (!state.ready) return;
            if (state.player.isMuted()) {
                state.player.unMute();
            } else {
                state.player.mute();
            }
            updateVolumeIcon();
        });

        // Progress
        dom.progressBar.addEventListener('click', handleProgressClick);

        // Toggle video
        dom.btnToggleVideo.addEventListener('click', () => {
            state.videoVisible = !state.videoVisible;
            const wrapper = $('#video-wrapper');
            if (state.videoVisible) {
                wrapper.style.height = '';
                wrapper.style.opacity = '1';
            } else {
                wrapper.style.height = '0';
                wrapper.style.opacity = '0';
            }
        });

        // Queue actions
        dom.btnSaveQueue.addEventListener('click', handleSaveQueue);
        dom.btnClearQueue.addEventListener('click', () => {
            if (state.queue.length === 0) return;
            if (confirm('Xóa tất cả bài hát trong danh sách?')) {
                clearQueue();
                toast('Đã xóa danh sách!');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
            if (e.code === 'ArrowRight') { e.preventDefault(); playNext(); }
            if (e.code === 'ArrowLeft') { e.preventDefault(); playPrev(); }
        });

        // Background Keep-Alive Trigger
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && state.isPlaying) {
                // Ensure silent audio is playing when backgrounded
                startBackgroundKeepAlive();
                
                // Force YouTube to resume if it paused automatically
                // On iOS we might need to nudge it multiple times
                let attempts = 0;
                const resumeInterval = setInterval(() => {
                    if (state.isPlaying && !state.isUserPaused && state.player && state.player.playVideo) {
                        const ps = state.player.getPlayerState ? state.player.getPlayerState() : -1;
                        if (ps !== YT.PlayerState.PLAYING) {
                            state.player.playVideo();
                        } else {
                            clearInterval(resumeInterval);
                        }
                    }
                    attempts++;
                    if (attempts > 5) clearInterval(resumeInterval);
                }, 500);
            }
        });

        // iOS specific: pagehide is often more reliable
        window.addEventListener('pagehide', () => {
            if (state.isPlaying && !state.isUserPaused) {
                startBackgroundKeepAlive();
            }
        });
    }

    function updateVolumeIcon() {
        const muted = state.ready && state.player.isMuted && state.player.isMuted();
        dom.iconVolume.style.display = muted ? 'none' : 'block';
        dom.iconMute.style.display = muted ? 'block' : 'none';
    }

    // --- Init ---
    function init() {
        loadQueueFromStorage();
        renderSavedPlaylists();
        bindEvents();
        loadYTApi();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
