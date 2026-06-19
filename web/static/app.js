/**
 * 小途 · 智能旅行助手 v3.0
 * - SSE 流式对话
 * - Leaflet 地图可视化（景点标注 + 路线绘制）
 * - 行程编辑器（拖拽排序 + 添加/删除景点 + 实时地图同步）
 */
(function () {
    'use strict';

    // ====== DOM ======
    const chatContainer = document.getElementById('chatContainer');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const resetBtn = document.getElementById('resetBtn');
    const toggleMapBtn = document.getElementById('toggleMapBtn');
    const welcomeCard = document.getElementById('welcomeCard');
    const imageModal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    const mapContainer = document.getElementById('mapContainer');
    const mapPlaceholder = document.getElementById('mapPlaceholder');
    const itineraryBody = document.getElementById('itineraryBody');
    const itineraryEmpty = document.getElementById('itineraryEmpty');
    const addSpotBtn = document.getElementById('addSpotBtn');
    const spotModal = document.getElementById('spotModal');
    const spotModalInput = document.getElementById('spotModalInput');
    const spotModalCancel = document.getElementById('spotModalCancel');
    const spotModalConfirm = document.getElementById('spotModalConfirm');
    const itineraryFooter = document.getElementById('itineraryFooter');
    const newSpotInput = document.getElementById('newSpotInput');

    // ====== State ======
    let isStreaming = false;
    let currentAgentBubble = null;
    let currentTextBuffer = '';
    let renderTimer = null;

    // Map state
    let map = null;
    let markers = [];
    let routeLine = null;
    let mapInitialized = false;

    // Itinerary state
    let itineraryData = { destination: '', days: 0, spots: [] }; // { day: 1, spots: [{name, time, lng, lat}] }

    // ====== Init Map (immediately, don't wait for itinerary) ======
    function initMap() {
        if (mapInitialized) return;
        try {
            map = L.map(mapContainer, { center: [35.86, 104.19], zoom: 5 });
            // 高德地图图块（免费，国内速度快，中文标注）
            L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
                subdomains: '1234',
                attribution: '&copy; 高德地图',
                maxZoom: 18,
            }).addTo(map);
            mapInitialized = true;
            mapPlaceholder.style.display = 'none';
            mapContainer.style.zIndex = '1';
            setTimeout(() => map.invalidateSize(), 200);
        } catch (e) {
            console.error('Map init failed:', e);
        }
    }

    // Initialize map on page load
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initMap, 300);
    });
    // Also init on first interaction
    let _mapInitTried = false;
    function ensureMap() {
        if (!_mapInitTried) { _mapInitTried = true; initMap(); }
    }

    function showOnMap(lng, lat, name, zoom) {
        initMap();
        map.setView([lat, lng], zoom || 13);
        const marker = L.marker([lat, lng]).addTo(map).bindPopup(name);
        marker.openPopup();
        markers.push(marker);
    }

    function clearMap() {
        markers.forEach(m => map && map.removeLayer(m));
        markers = [];
        if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
    }

    function drawRoute(coords) {
        if (!map) return;
        if (routeLine) map.removeLayer(routeLine);
        if (coords.length < 2) return;
        routeLine = L.polyline(coords, {
            color: '#0ea5e9', weight: 3, opacity: 0.7,
            dashArray: '10 5',
        }).addTo(map);
        map.fitBounds(routeLine.getBounds().pad(0.1));
    }

    // ====== Init Controls ======
    messageInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
    });
    sendBtn.addEventListener('click', sendMessage);
    resetBtn.addEventListener('click', resetChat);
    toggleMapBtn.addEventListener('click', () => {
        document.getElementById('mapPanel').classList.toggle('collapsed');
    });

    // Quick buttons
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            messageInput.value = btn.textContent.trim();
            sendMessage();
        });
    });

    // Image lightbox
    chatContainer.addEventListener('click', e => {
        const img = e.target.closest('img');
        if (img && img.src.includes('unsplash')) {
            modalImg.src = img.src.replace(/&w=\d+/, '&w=1600');
            imageModal.classList.add('active');
        }
    });
    imageModal.addEventListener('click', () => imageModal.classList.remove('active'));

    // Add spot modal
    addSpotBtn.addEventListener('click', () => {
        spotModal.classList.add('active');
        spotModalInput.focus();
    });
    spotModalCancel.addEventListener('click', () => spotModal.classList.remove('active'));
    spotModal.addEventListener('click', e => { if (e.target === spotModal) spotModal.classList.remove('active'); });
    spotModalConfirm.addEventListener('click', addNewSpot);
    spotModalInput.addEventListener('keydown', e => { if (e.key === 'Enter') addNewSpot(); });

    // ====== Destination extraction ======
    function extractDestination(text) {
        // Try to find city name from query patterns like "丽江3天", "去成都玩", "三亚旅游"
        const patterns = [
            /去\s*([一-鿿]{2,4})\s*(?:玩|旅游|旅行|度假|出差)/,
            /([一-鿿]{2,4})\s*(?:\d+天|三日|五日|七日|旅游|旅行|游玩|推荐|攻略|行程|规划)/,
            /(?:在|到)\s*([一-鿿]{2,4})\s*(?:玩|旅游|旅行)/,
            /([一-鿿]{2,4}(?:市|省|州|县))(?:\s|\d|旅游|旅行|玩)/,
        ];
        for (const p of patterns) {
            const m = text.match(p);
            if (m && m[1] && !/上午|下午|中午|晚上|推荐|注意|安全/.test(m[1])) {
                return m[1].replace(/市$/, '');
            }
        }
        return '';
    }

    async function preGeocodeDestination(destName) {
        if (!destName) return;
        try {
            const resp = await fetch('/api/geocode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: destName }),
            });
            const data = await resp.json();
            if (data.success && data.lng) {
                ensureMap(); initMap();
                clearMap();
                map.setView([data.lat, data.lng], 12);
                const m = L.marker([data.lat, data.lng]).addTo(map)
                    .bindPopup('<b>' + escapeHtml(destName) + '</b>');
                m.openPopup();
                markers.push(m);
                itineraryData.destination = destName;
                itineraryData.days = 0;
                itineraryData.spots = [];
            }
        } catch (e) { /* ignore */ }
    }

    // ====== Send Message ======
    async function sendMessage() {
        if (isStreaming) return;
        const text = messageInput.value.trim();
        if (!text) return;

        if (welcomeCard) welcomeCard.style.display = 'none';
        addUserMessage(text);

        // === ALWAYS: clear old data & try to locate the destination immediately ===
        ensureMap(); initMap();
        clearMap();
        itineraryData = { destination: '', days: 0, spots: [] };
        itineraryBody.innerHTML = '<div class="itinerary-empty"><p>正在解析目的地...</p><p class="sub">Agent 规划中，请稍候</p></div>';

        // Extract destination and pre-geocode (don't wait for Agent)
        const dest = extractDestination(text);
        if (dest) {
            preGeocodeDestination(dest);
        }

        messageInput.value = '';
        messageInput.style.height = 'auto';
        scrollChatBottom();

        setInputEnabled(false);
        isStreaming = true;

        currentAgentBubble = addAgentBubblePending();

        try {
            const resp = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() || '';

                let evtType = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) { evtType = line.slice(7).trim(); }
                    else if (line.startsWith('data: ')) { handleSSE(evtType, line.slice(6)); evtType = ''; }
                }
            }
        } catch (err) {
            finalizeBubble();
            addError(err.message);
        } finally {
            isStreaming = false;
            setInputEnabled(true);
            messageInput.focus();
            finalizeBubble();
        }
    }

    function handleSSE(type, dataStr) {
        try {
            const p = JSON.parse(dataStr);
            switch (type) {
                case 'thinking': break;
                case 'tool_start': addToolStart(p.name, p.args); break;
                case 'tool_end':
                    addToolEnd(p.name, p.result);
                    if (p.name === 'generate_itinerary' && p.result.success) {
                        loadItineraryFromTool(p.result);
                    }
                    if (p.name === 'search_attractions' && p.result.success) {
                        loadAttractionsFromTool(p.result);
                    }
                    break;
                case 'token': appendToken(p.content); break;
                case 'done': {
                    // Capture text before finalize clears it
                    const finalText = currentTextBuffer;
                    const dest = itineraryData.destination;
                    finalizeBubble();
                    // Extract attractions from Agent's text and geocode them
                    if (dest && finalText) {
                        geocodeAndPlotAttractions(finalText, dest);
                    }
                    break;
                }
                case 'error': addError(p.error); break;
            }
        } catch (e) {
            if (type === 'token') appendToken(dataStr);
        }
    }

    // ====== Token Rendering ======
    function appendToken(token) {
        ensureAgentBubbleReady();
        currentTextBuffer += token;
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            if (currentAgentBubble) {
                currentAgentBubble.innerHTML = typeof marked !== 'undefined'
                    ? marked.parse(currentTextBuffer) : escapeHtml(currentTextBuffer).replace(/\n/g, '<br>');
                bindImgClicks(currentAgentBubble);
                scrollChatBottom();
            }
        }, 50);
    }

    function ensureAgentBubbleReady() {
        if (!currentAgentBubble || currentAgentBubble.classList.contains('pending')) {
            if (currentAgentBubble && currentAgentBubble.parentElement) currentAgentBubble.parentElement.remove();
            const div = document.createElement('div');
            div.className = 'message agent';
            div.innerHTML = '<div class="avatar">🌍</div><div class="bubble cursor-blink"></div>';
            chatContainer.appendChild(div);
            currentAgentBubble = div.querySelector('.bubble');
        }
    }

    function finalizeBubble() {
        if (renderTimer) clearTimeout(renderTimer);
        if (currentAgentBubble && currentTextBuffer) {
            currentAgentBubble.innerHTML = typeof marked !== 'undefined'
                ? marked.parse(currentTextBuffer) : escapeHtml(currentTextBuffer).replace(/\n/g, '<br>');
            currentAgentBubble.classList.remove('cursor-blink');
            bindImgClicks(currentAgentBubble);
        }
        if (currentAgentBubble) currentAgentBubble.classList.remove('cursor-blink');
        currentAgentBubble = null;
        currentTextBuffer = '';
        renderTimer = null;
        scrollChatBottom();
    }

    // ====== UI Builders ======
    function addUserMessage(text) {
        const div = document.createElement('div');
        div.className = 'message user';
        div.innerHTML = '<div class="avatar">🧳</div><div class="bubble">' + escapeHtml(text) + '</div>';
        chatContainer.appendChild(div);
        scrollChatBottom();
    }

    function addAgentBubblePending() {
        const div = document.createElement('div');
        div.className = 'message agent';
        div.innerHTML = '<div class="avatar">🌍</div><div class="bubble pending"><div class="dots"><span></span><span></span><span></span></div></div>';
        chatContainer.appendChild(div);
        scrollChatBottom();
        return div.querySelector('.bubble');
    }

    function addToolStart(name, args) {
        const iconMap = { get_weather: '🌤️', search_destination_images: '📸', generate_itinerary: '📋', search_attractions: '📍', geocode_poi: '📍' };
        const labelMap = { get_weather: '正在查询天气', search_destination_images: '正在搜索美图', generate_itinerary: '正在规划行程', search_attractions: '搜索景点坐标', geocode_poi: '定位地点' };
        const cssMap = { get_weather: 'weather', search_destination_images: 'image', generate_itinerary: 'itinerary', search_attractions: 'itinerary', geocode_poi: 'itinerary' };

        let detail = '';
        if (name === 'get_weather') detail = args.city_name || '';
        else if (name === 'search_destination_images') detail = (args.query || '').slice(0, 30);
        else if (name === 'generate_itinerary') detail = `${args.destination || ''} ${args.days || ''}天`;
        else if (name === 'search_attractions') detail = args.city || '';
        else if (name === 'geocode_poi') detail = args.address || '';

        const div = document.createElement('div');
        div.className = 'tool-call ' + (cssMap[name] || '');
        div.innerHTML = `<span class="tool-icon">${iconMap[name]||'🔧'}</span><span class="tool-label">${labelMap[name]||name}</span><span class="tool-detail">${escapeHtml(detail)}</span>`;
        chatContainer.appendChild(div);
        scrollChatBottom();
    }

    function addToolEnd(name, result) {
        if (name === 'search_destination_images' && result.success) {
            const div = document.createElement('div');
            div.className = 'tool-call image';
            div.style.background = '#f0fdf4'; div.style.border = '1px solid #bbf7d0';
            div.innerHTML = `<span class="tool-icon">✅</span><span class="tool-label">已获取 ${result.images?.length||0} 张实景照片</span>`;
            chatContainer.appendChild(div);
            scrollChatBottom();
        }
        if (name === 'generate_itinerary' && result.success && result.map_data) {
            const div = document.createElement('div');
            div.className = 'tool-call itinerary';
            div.style.background = '#f0fdf4'; div.style.border = '1px solid #bbf7d0';
            div.innerHTML = `<span class="tool-icon">🗺️</span><span class="tool-label">地图已定位至 ${escapeHtml(result.destination||'')}，景点解析中...</span>`;
            chatContainer.appendChild(div);
            scrollChatBottom();
        }
    }

    function addError(msg) {
        const div = document.createElement('div');
        div.className = 'tool-call weather';
        div.style.background = '#fef2f2'; div.style.color = '#991b1b'; div.style.border = '1px solid #fecaca';
        div.innerHTML = '<span class="tool-icon">❌</span><span>' + escapeHtml(msg) + '</span>';
        chatContainer.appendChild(div);
        scrollChatBottom();
    }

    // ====== Map + Itinerary Loading ======
    function loadItineraryFromTool(result) {
        // Only center map on destination city
        if (!result.map_data) return;
        const md = result.map_data;
        ensureMap();
        initMap();
        clearMap();

        itineraryData = {
            destination: result.destination || '',
            days: result.days || 0,
            spots: [],
        };

        if (md.city_center && md.city_center.lng && md.city_center.lat) {
            map.setView([md.city_center.lat, md.city_center.lng], 12);
            const m = L.marker([md.city_center.lat, md.city_center.lng]).addTo(map)
                .bindPopup('<b>' + escapeHtml(result.destination) + '</b>');
            m.openPopup();
            markers.push(m);
        }
    }

    /**
     * Extract attraction names from the LLM's Markdown response text.
     * Looks for patterns like:
     *   - 【故宫博物院】
     *   - **故宫博物院**
     *   - 参观「故宫博物院」
     *   - 前往【故宫博物院】
     */
    function extractAttractionNames(markdownText) {
        const names = new Set();
        // Pattern 1: 【...】
        const re1 = /【(.+?)】/g;
        let m;
        while ((m = re1.exec(markdownText)) !== null) {
            const name = m[1].trim();
            if (name.length >= 3 && name.length <= 30 && !/[0-9]{4}/.test(name)) {
                names.add(name);
            }
        }
        // Pattern 2: 「...」
        const re2 = /「(.+?)」/g;
        while ((m = re2.exec(markdownText)) !== null) {
            const name = m[1].trim();
            if (name.length >= 3 && name.length <= 30) names.add(name);
        }
        // Pattern 3: **bold** markers (attraction names often bolded)
        const re3 = /\*\*(.+?)\*\*/g;
        while ((m = re3.exec(markdownText)) !== null) {
            const name = m[1].trim();
            // Filter: must look like a place name (contains Chinese, 3-20 chars)
            if (/[一-鿿]/.test(name) && name.length >= 3 && name.length <= 20 &&
                !/[：:，。！？\d{3}]/.test(name) && !/上午|下午|晚上|中午|推荐|建议|注意|提示/.test(name)) {
                names.add(name);
            }
        }
        // Filter out non-attraction words
        const excludeWords = [
            '上午', '中午', '下午', '晚上', '推荐', '建议', '注意', '提示', '预算', '住宿', '餐饮',
            '交通', '地铁', '公交', '打车', '步行', '预订', '开放时间', '门票', '必备物品', '安全提醒',
            '交通方式', '特色美食', '住宿建议', '弹性时间', '注意事项',
        ];
        const excludePattern = /第[一二三四五六七八九十\d]+天|Day\s*\d|上午|下午|中午|晚上|推荐|建议|小贴士|预算参考|行前准备|必备清单|费用估算/;
        return [...names].filter(n => {
            if (excludeWords.includes(n)) return false;
            if (excludePattern.test(n)) return false;
            if (n.length < 3) return false;
            return true;
        });
    }

    /**
     * After LLM finishes, extract attractions from the text and geocode them.
     * This ensures the map shows exactly what the Agent recommended.
     */
    async function geocodeAndPlotAttractions(markdownText, destination) {
        const names = extractAttractionNames(markdownText);
        if (names.length === 0) return;

        const geocoded = [];
        for (const name of names) {
            try {
                const cityHint = destination ? destination : '';
                const resp = await fetch('/api/geocode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: name + ' ' + cityHint }),
                });
                const data = await resp.json();
                if (data.success && data.lng) {
                    geocoded.push({ name, lng: data.lng, lat: data.lat, time: '' });
                }
            } catch (e) { /* skip failed geocodes */ }
        }

        if (geocoded.length === 0) return;

        // Update itineraryData with geocoded attractions
        const days = itineraryData.days || 1;
        const perDay = Math.max(2, Math.ceil(geocoded.length / days));
        itineraryData.spots = [];
        for (let d = 0; d < days; d++) {
            const daySpots = geocoded.slice(d * perDay, (d + 1) * perDay);
            if (daySpots.length > 0) {
                itineraryData.spots.push({ day: d + 1, spots: daySpots });
            }
        }

        // Plot on map
        ensureMap();
        const allCoords = [];
        geocoded.forEach(s => {
            if (s.lng && s.lat) {
                const mk = L.marker([s.lat, s.lng]).addTo(map)
                    .bindPopup('<b>' + escapeHtml(s.name) + '</b>');
                markers.push(mk);
                allCoords.push([s.lat, s.lng]);
            }
        });

        if (allCoords.length >= 2) drawRoute(allCoords);
        else if (allCoords.length === 1) map.setView(allCoords[0], 14);

        renderItinerary();
    }

    function loadAttractionsFromTool(result) {
        if (!result.attractions) return;
        ensureMap();
        initMap();
        clearMap();
        itineraryData = { destination: result.city || '', days: 1, spots: [{ day: 1, spots: [] }] };

        result.attractions.forEach(att => {
            if (att.lng && att.lat) {
                const mk = L.marker([att.lat, att.lng]).addTo(map)
                    .bindPopup('<b>' + escapeHtml(att.name) + '</b><br>' + escapeHtml(att.address || ''));
                markers.push(mk);
                itineraryData.spots[0].spots.push({
                    name: att.name,
                    time: '',
                    lng: att.lng,
                    lat: att.lat,
                });
            }
        });

        if (itineraryData.spots[0].spots.length > 0) {
            const first = itineraryData.spots[0].spots[0];
            map.setView([first.lat, first.lng], 13);
        }

        const allCoords = itineraryData.spots[0].spots
            .filter(s => s.lat && s.lng)
            .map(s => [s.lat, s.lng]);
        if (allCoords.length >= 2) drawRoute(allCoords);

        renderItinerary();
    }

    // ====== Itinerary Renderer ======
    function renderItinerary() {
        itineraryBody.innerHTML = '';
        itineraryEmpty.style.display = 'none';

        if (!itineraryData.spots.length) {
            itineraryBody.innerHTML = '<div class="itinerary-empty"><p>暂无行程数据</p></div>';
            return;
        }

        itineraryData.spots.forEach(day => {
            const group = document.createElement('div');
            group.className = 'day-group';
            group.innerHTML = `<div class="day-group-header"><span class="day-icon">📅</span>Day ${day.day}</div>`;

            const list = document.createElement('ul');
            list.className = 'spot-list';
            list.dataset.day = day.day;

            day.spots.forEach((spot, idx) => {
                const li = document.createElement('li');
                li.className = 'spot-item';
                li.dataset.day = day.day;
                li.dataset.index = idx;
                li.dataset.name = spot.name;
                li.innerHTML = `
                    <span class="drag-handle">⋮⋮</span>
                    <span class="spot-order">${idx + 1}</span>
                    <span class="spot-name">${escapeHtml(spot.name)}</span>
                    <span class="spot-time">${escapeHtml(spot.time || '')}</span>
                    <button class="spot-locate" title="在地图上定位">📍</button>
                    <button class="spot-delete" title="删除">×</button>
                `;

                // Locate button
                li.querySelector('.spot-locate').addEventListener('click', e => {
                    e.stopPropagation();
                    if (spot.lng && spot.lat) {
                        initMap();
                        map.setView([spot.lat, spot.lng], 15);
                        const m = L.marker([spot.lat, spot.lng]).addTo(map)
                            .bindPopup('<b>' + escapeHtml(spot.name) + '</b>');
                        m.openPopup();
                        markers.push(m);
                    } else {
                        geocodeAndShow(spot.name);
                    }
                });

                // Delete button
                li.querySelector('.spot-delete').addEventListener('click', e => {
                    e.stopPropagation();
                    deleteSpot(day.day, idx);
                });

                list.appendChild(li);
            });

            group.appendChild(list);

            // Sortable
            new Sortable(list, {
                group: 'itinerary',
                handle: '.drag-handle',
                animation: 150,
                onEnd: function (evt) {
                    const fromDay = parseInt(evt.from.dataset.day);
                    const toDay = evt.to ? parseInt(evt.to.dataset.day) : fromDay;
                    const oldIdx = evt.oldIndex;
                    const newIdx = evt.newIndex;

                    // Find and move the spot
                    const fromDayData = itineraryData.spots.find(d => d.day === fromDay);
                    if (!fromDayData) return;
                    const [moved] = fromDayData.spots.splice(oldIdx, 1);
                    const toDayData = itineraryData.spots.find(d => d.day === toDay);
                    if (toDayData) {
                        toDayData.spots.splice(newIdx, 0, moved);
                    } else {
                        fromDayData.spots.splice(newIdx, 0, moved);
                    }
                    renderItinerary();
                    refreshMapFromItinerary();
                },
            });

            itineraryBody.appendChild(group);
        });

        itineraryEmpty.style.display = 'none';
    }

    function deleteSpot(day, index) {
        const dayData = itineraryData.spots.find(d => d.day === day);
        if (!dayData) return;
        dayData.spots.splice(index, 1);
        // Clean up empty days
        itineraryData.spots = itineraryData.spots.filter(d => d.spots.length > 0);
        // Re-number days
        itineraryData.spots.forEach((d, i) => { d.day = i + 1; });
        renderItinerary();
        refreshMapFromItinerary();
    }

    async function addNewSpot() {
        const name = spotModalInput.value.trim();
        if (!name) return;
        spotModal.classList.remove('active');
        spotModalInput.value = '';

        // Geocode the spot
        let lng = 0, lat = 0;
        try {
            const resp = await fetch('/api/geocode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: name }),
            });
            const data = await resp.json();
            if (data.success) {
                lng = data.lng; lat = data.lat;
            }
        } catch (e) { /* ignore geocode errors */ }

        // Add to last day or create day 1
        if (!itineraryData.spots.length) {
            itineraryData.spots = [{ day: 1, spots: [] }];
        }
        const lastDay = itineraryData.spots[itineraryData.spots.length - 1];
        lastDay.spots.push({ name, time: '', lng, lat });

        renderItinerary();

        // Show on map
        if (lng && lat) {
            initMap();
            const m = L.marker([lat, lng]).addTo(map).bindPopup('<b>' + escapeHtml(name) + '</b>');
            m.openPopup();
            markers.push(m);
            map.setView([lat, lng], 14);
            refreshMapFromItinerary();
        }
    }

    async function geocodeAndShow(name) {
        ensureMap();
        try {
            const resp = await fetch('/api/geocode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: name }),
            });
            const data = await resp.json();
            if (data.success && data.lng) {
                initMap();
                map.setView([data.lat, data.lng], 15);
                const m = L.marker([data.lat, data.lng]).addTo(map)
                    .bindPopup('<b>' + escapeHtml(name) + '</b>');
                m.openPopup();
                markers.push(m);
            }
        } catch (e) { /* ignore */ }
    }

    function refreshMapFromItinerary() {
        ensureMap();
        clearMap();
        const allCoords = [];
        itineraryData.spots.forEach(day => {
            day.spots.forEach(s => {
                if (s.lng && s.lat) {
                    const m = L.marker([s.lat, s.lng]).addTo(map)
                        .bindPopup('<b>' + escapeHtml(s.name) + '</b>');
                    markers.push(m);
                    allCoords.push([s.lat, s.lng]);
                }
            });
        });
        if (allCoords.length >= 2) drawRoute(allCoords);
        else if (allCoords.length === 1) map.setView(allCoords[0], 14);
    }

    // ====== Helpers ======
    function setInputEnabled(enabled) {
        messageInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
        sendBtn.style.background = enabled ? '' : '#94a3b8';
        sendBtn.style.cursor = enabled ? '' : 'not-allowed';
    }

    function scrollChatBottom() {
        requestAnimationFrame(() => { chatContainer.scrollTop = chatContainer.scrollHeight; });
    }

    async function resetChat() {
        await fetch('/api/reset', { method: 'POST' });
        chatContainer.querySelectorAll('.message, .tool-call, .loading').forEach(n => n.remove());
        if (welcomeCard) welcomeCard.style.display = '';
        currentAgentBubble = null;
        currentTextBuffer = '';
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = null;
        // Reset map & itinerary
        itineraryData = { destination: '', days: 0, spots: [] };
        itineraryBody.innerHTML = '<div class="itinerary-empty"><p>暂无行程数据</p><p class="sub">在聊天中规划行程后，这里将显示可编辑的景点列表</p></div>';
        clearMap();
        if (map) {
            map.setView([35.86, 104.19], 5);
            map.invalidateSize();
        }
    }

    function bindImgClicks(container) {
        container.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('data-bound')) {
                img.setAttribute('data-bound', '1');
                img.addEventListener('click', () => {
                    if (img.src.includes('unsplash')) {
                        modalImg.src = img.src.replace(/&w=\d+/, '&w=1600');
                        imageModal.classList.add('active');
                    }
                });
            }
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
})();
