/**
 * 小途 · 智能旅行助手 — 前端交互逻辑
 *
 * 功能:
 *  - SSE 流式对话（token 级实时渲染）
 *  - Markdown 渲染 (marked.js)
 *  - 工具调用过程可视化
 *  - Unsplash 图片灯箱预览
 *  - 快速提问入口
 */
(function () {
    'use strict';

    // ====== DOM 元素 ======
    const chatContainer = document.getElementById('chatContainer');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const resetBtn = document.getElementById('resetBtn');
    const welcomeCard = document.getElementById('welcomeCard');
    const imageModal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');

    let isStreaming = false;
    let currentAgentBubble = null;   // 当前正在填充的 agent 气泡
    let currentTextBuffer = '';      // 当前累积的 Markdown 文本
    let renderTimer = null;          // Markdown 渲染节流计时器

    // ====== 初始化 ======
    messageInput.addEventListener('keydown', onKeyDown);
    messageInput.addEventListener('input', autoResize);
    sendBtn.addEventListener('click', sendMessage);
    resetBtn.addEventListener('click', resetChat);

    // 快速提问按钮
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            messageInput.value = btn.textContent.trim();
            sendMessage();
        });
    });

    // 图片灯箱（事件委托）
    chatContainer.addEventListener('click', e => {
        const img = e.target.closest('img');
        if (img && img.src.includes('unsplash')) {
            modalImg.src = img.src.replace(/&w=\d+/, '&w=1600');
            imageModal.classList.add('active');
        }
    });
    imageModal.addEventListener('click', () => imageModal.classList.remove('active'));

    // ====== 发送消息 ======
    async function sendMessage() {
        if (isStreaming) return;

        const text = messageInput.value.trim();
        if (!text) return;

        // 隐藏欢迎卡片
        if (welcomeCard) welcomeCard.style.display = 'none';

        // 添加用户气泡
        addUserMessage(text);
        messageInput.value = '';
        autoResize();
        scrollToBottom();

        setInputEnabled(false);
        isStreaming = true;

        // 创建等待中的 agent 气泡（带跳跃点动画）
        currentAgentBubble = addAgentBubblePending();

        try {
            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let eventType = '';
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        handleSSEEvent(eventType, dataStr);
                        eventType = '';
                    }
                }
            }
        } catch (err) {
            finalizeBubble();
            addErrorMessage(`连接失败: ${err.message}`);
            console.error(err);
        } finally {
            isStreaming = false;
            setInputEnabled(true);
            messageInput.focus();
            finalizeBubble();
        }
    }

    // ====== SSE 事件分发 ======
    function handleSSEEvent(type, dataStr) {
        try {
            const payload = JSON.parse(dataStr);

            switch (type) {
                case 'thinking':
                    // Agent 开始生成最终回复，气泡保持等待状态
                    break;

                case 'tool_start':
                    // 工具调用开始 → 显示彩色标签
                    addToolStart(payload.name, payload.args);
                    break;

                case 'tool_end':
                    // 工具调用完成 → 显示完成提示
                    addToolEnd(payload.name, payload.result);
                    break;

                case 'token':
                    // ====== 核心流式：逐 token 追加到气泡 ======
                    appendToken(payload.content);
                    break;

                case 'done':
                    // 回复完成
                    finalizeBubble();
                    break;

                case 'error':
                    addErrorMessage(payload.error || '未知错误');
                    break;
            }
        } catch (e) {
            // 如果不是 JSON，当做纯文本 token
            if (type === 'token') {
                appendToken(dataStr);
            }
        }
    }

    // ====== Token 追加 & Markdown 渲染 ======
    function appendToken(token) {
        // 将气泡从 pending 状态转正
        ensureAgentBubbleReady();

        currentTextBuffer += token;

        // 节流渲染：每 50ms 渲染一次，保证流畅
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            if (currentAgentBubble) {
                const rendered = typeof marked !== 'undefined'
                    ? marked.parse(currentTextBuffer)
                    : escapeHtml(currentTextBuffer).replace(/\n/g, '<br>');
                currentAgentBubble.innerHTML = rendered;
                bindImageClicks(currentAgentBubble);
                scrollToBottom();
            }
        }, 50);
    }

    function ensureAgentBubbleReady() {
        if (!currentAgentBubble || currentAgentBubble.classList.contains('pending')) {
            // 移除旧的 pending 气泡
            if (currentAgentBubble) {
                currentAgentBubble.parentElement.remove();
            }
            // 创建正式的 agent 气泡（光标闪烁）
            const div = document.createElement('div');
            div.className = 'message agent';
            div.innerHTML = `
                <div class="avatar">🌍</div>
                <div class="bubble cursor-blink"></div>
            `;
            chatContainer.appendChild(div);
            currentAgentBubble = div.querySelector('.bubble');
        }
    }

    function finalizeBubble() {
        if (renderTimer) clearTimeout(renderTimer);

        // 最终渲染一次
        if (currentAgentBubble && currentTextBuffer) {
            const rendered = typeof marked !== 'undefined'
                ? marked.parse(currentTextBuffer)
                : escapeHtml(currentTextBuffer).replace(/\n/g, '<br>');
            currentAgentBubble.innerHTML = rendered;
            currentAgentBubble.classList.remove('cursor-blink');
            bindImageClicks(currentAgentBubble);
        }

        if (currentAgentBubble) {
            currentAgentBubble.classList.remove('cursor-blink');
        }

        currentAgentBubble = null;
        currentTextBuffer = '';
        renderTimer = null;
        scrollToBottom();
    }

    // ====== UI 构建函数 ======

    function addUserMessage(text) {
        const div = document.createElement('div');
        div.className = 'message user';
        div.innerHTML = `
            <div class="avatar">🧳</div>
            <div class="bubble">${escapeHtml(text)}</div>
        `;
        chatContainer.appendChild(div);
        scrollToBottom();
    }

    /**
     * 创建等待中的 agent 气泡（三个跳跃点动画）
     */
    function addAgentBubblePending() {
        const div = document.createElement('div');
        div.className = 'message agent';
        div.innerHTML = `
            <div class="avatar">🌍</div>
            <div class="bubble pending">
                <div class="dots"><span></span><span></span><span></span></div>
            </div>
        `;
        chatContainer.appendChild(div);
        scrollToBottom();
        return div.querySelector('.bubble');
    }

    function addToolStart(name, args) {
        const iconMap = {
            get_weather: '🌤️',
            search_destination_images: '📸',
            generate_itinerary: '📋',
        };
        const labelMap = {
            get_weather: '正在查询天气',
            search_destination_images: '正在搜索美图',
            generate_itinerary: '正在规划行程',
        };
        const cssMap = {
            get_weather: 'weather',
            search_destination_images: 'image',
            generate_itinerary: 'itinerary',
        };

        let detail = '';
        if (name === 'get_weather') detail = args.city_name || '';
        else if (name === 'search_destination_images') detail = (args.query || '').slice(0, 30);
        else if (name === 'generate_itinerary') detail = `${args.destination || ''} ${args.days || ''}天`;

        const div = document.createElement('div');
        div.className = `tool-call ${cssMap[name] || ''}`;
        div.id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        div.innerHTML = `
            <span class="tool-icon">${iconMap[name] || '🔧'}</span>
            <span class="tool-label">${labelMap[name] || name}</span>
            <span class="tool-detail">${escapeHtml(detail)}</span>
        `;
        chatContainer.appendChild(div);
        scrollToBottom();
    }

    function addToolEnd(name, result) {
        if (name === 'search_destination_images' && result.success && result.images) {
            const div = document.createElement('div');
            div.className = 'tool-call image';
            div.style.background = '#f0fdf4';
            div.style.border = '1px solid #bbf7d0';
            div.innerHTML = `
                <span class="tool-icon">✅</span>
                <span class="tool-label">已获取 ${result.images.length} 张实景照片</span>
            `;
            chatContainer.appendChild(div);
            scrollToBottom();
        } else if (name === 'get_weather' && result.success) {
            const div = document.createElement('div');
            div.className = 'tool-call weather';
            div.style.background = '#f0fdf4';
            div.style.border = '1px solid #bbf7d0';
            div.innerHTML = `
                <span class="tool-icon">✅</span>
                <span class="tool-label">天气数据已获取</span>
            `;
            chatContainer.appendChild(div);
            scrollToBottom();
        }
    }

    function addErrorMessage(msg) {
        const div = document.createElement('div');
        div.className = 'tool-call weather';
        div.style.background = '#fef2f2';
        div.style.color = '#991b1b';
        div.style.border = '1px solid #fecaca';
        div.innerHTML = `<span class="tool-icon">❌</span> <span>${escapeHtml(msg)}</span>`;
        chatContainer.appendChild(div);
        scrollToBottom();
    }

    // ====== 辅助函数 ======

    function setInputEnabled(enabled) {
        messageInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
        if (enabled) {
            sendBtn.style.background = '';
            sendBtn.style.cursor = '';
        } else {
            sendBtn.style.background = '#94a3b8';
            sendBtn.style.cursor = 'not-allowed';
        }
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }

    function autoResize() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
    }

    function onKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    async function resetChat() {
        await fetch('/api/reset', { method: 'POST' });
        // 清空聊天记录
        const nodes = chatContainer.querySelectorAll('.message, .tool-call');
        nodes.forEach(n => n.remove());
        if (welcomeCard) welcomeCard.style.display = '';
        currentAgentBubble = null;
        currentTextBuffer = '';
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = null;
    }

    function bindImageClicks(container) {
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
