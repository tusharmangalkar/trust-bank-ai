const chatArea = document.getElementById('chatArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const clearBtn = document.getElementById('clearBtn');
const typingIndicator = document.getElementById('typingIndicator');
const charCount = document.getElementById('charCount');
const quickBtns = document.querySelectorAll('.quick-btn');
const audioPlayer = document.getElementById('audioPlayer'); 
const langSelectElement = document.getElementById('langSelect'); // NEW

const BACKEND_URL = 'http://127.0.0.1:5000';
const CHAT_STORAGE_KEY = 'chatHistory';
const LANG_STORAGE_KEY = 'selectedLanguage';


// Voice state for Web Speech API
let isListening = false;
let recognition = null; 

// ⏳ Professional loading stages
let loadingStageTimer = null;
let loadingStageIndex = 0;


// 🔊 TTS toggle state (REQUIRED)
let isSpeaking = false;
let activeTtsButton = null;

// 🔤 Current selected language (dropdown se)
let currentLang = 'en-IN';

// 🧭 Track whether user is at bottom
let isUserAtBottom = true;

chatArea.addEventListener('scroll', () => {
  const threshold = 10;
  isUserAtBottom =
    chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < threshold;
});


document.addEventListener('DOMContentLoaded', init);

// ⚠️ Small inline warning for empty input
function showInputWarning() {
  const warning = document.getElementById('inputWarning');
  if (!warning) {
    console.warn('inputWarning element not found');
    return;
  }

  warning.style.display = 'block';

  setTimeout(() => {
    warning.style.display = 'none';
  }, 2000);
}


// ---------- MARKDOWN → HTML FORMATTING ----------

function formatMarkdown(text) {
  if (!text) return '';

  let html = text;

  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Bullet points: - text OR * text
  html = html.replace(/^\s*[-*]\s+(.*)$/gm, '<br>• $1');

  // Numbered lists (only if line STARTS with number)
  html = html.replace(/^\s*(\d+)\.\s+(.*)$/gm, '<br>$1. $2');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // Remove any accidental leading <br>
  html = html.replace(/^<br>/, '');

  return html.trim();
}

// 🔐 LANGUAGE LOCK VALIDATOR
function isTextInSelectedLanguage(text, lang) {
  const patterns = {
    "en-IN": /^[A-Za-z0-9\s.,?!'"\-()]+$/,
    "hi-IN": /^[\u0900-\u097F0-9\s.,?!'"\-()]+$/,
    "mr-IN": /^[\u0900-\u097F0-9\s.,?!'"\-()]+$/,
    "ta-IN": /^[\u0B80-\u0BFF0-9\s.,?!'"\-()]+$/,
    "te-IN": /^[\u0C00-\u0C7F0-9\s.,?!'"\-()]+$/,
    "kn-IN": /^[\u0C80-\u0CFF0-9\s.,?!'"\-()]+$/,
    "bn-IN": /^[\u0980-\u09FF0-9\s.,?!'"\-()]+$/
  };

  return patterns[lang].test(text);
}


// --- VOICE FUNCTIONS (Speech-to-Text & Text-to-Speech) ---

function applyCurrentLangToRecognition() {
    if (recognition) {
        recognition.lang = currentLang;
    }
}

function initializeVoiceRecognition() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = false; 
        recognition.interimResults = false;

        // 🎙️ Use currently selected language
        recognition.lang = currentLang;

        recognition.onstart = () => {
            isListening = true;
            showTyping("Listening for your question...");
        };

        recognition.onresult = (event) => {
            let transcript = '';

            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }

            messageInput.value = transcript.trim();
            updateCharCount();
            autoResize();
        };


        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            hideTyping();
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                addMessage(`🎤 Voice Error: ${event.error}. Please ensure microphone access is granted.`, 'bot');
            }
            stopVoiceInput();
        };

       recognition.onend = () => {
       stopVoiceInput();

       const finalText = messageInput.value.trim();
        if (finalText.length > 0) {
            sendMessage(); // 🚀 auto-trigger model after voice input ends
        }
    };
    } else {
        micBtn.style.display = 'none';
        console.warn("Web Speech API not supported in this browser.");
    }

}

function startVoiceInput() {
    if (!recognition) return;
    
    if (isListening) {
        recognition.stop();
        stopVoiceInput();
    } else {
        recognition.start();
    }
}

function stopVoiceInput() {
    isListening = false;
    hideTyping();
}


// 🔊 TTS: send text + currentLang to backend
async function speakResponse(text, buttonElement) {
    if (!text || text.length === 0) return;

    // ✅ FIX #3 — SAFETY GUARD (ADD HERE)
    if (isSpeaking && audioPlayer.paused) {
        isSpeaking = false;
        activeTtsButton = null;
    }

    // 🔴 If already speaking → STOP (toggle OFF)
    if (isSpeaking) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;

        isSpeaking = false;

        if (activeTtsButton) {
            activeTtsButton.textContent = '🔊';
            activeTtsButton.title = 'Replay audio';
            activeTtsButton.disabled = false;
        }

        activeTtsButton = null;
        return;
    }


    // ▶️ Start speaking
    isSpeaking = true;
    activeTtsButton = buttonElement;

    const originalText = buttonElement.textContent;
    const originalTitle = buttonElement.title;

    buttonElement.textContent = '⏹️';
    buttonElement.title = 'Stop audio';

    try {
        const response = await fetch(`${BACKEND_URL}/generate_audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                lang: currentLang
            })
        });

        if (!response.ok) throw new Error('TTS failed');

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        audioPlayer.src = audioUrl;
        await audioPlayer.play();


        audioPlayer.onended = () => {
            cleanupTts(buttonElement, originalText, originalTitle, audioUrl);
        };

    } catch (error) {
        console.error('TTS error:', error);
        cleanupTts(buttonElement, originalText, originalTitle);
        addMessage('🔊 Audio playback failed.', 'bot');
    }
}

function cleanupTts(button, originalText, originalTitle, audioUrl = null) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);

    isSpeaking = false;
    activeTtsButton = null;

    button.textContent = originalText;
    button.title = originalTitle;
    button.disabled = false;

    audioPlayer.onended = null;
}



// --- CORE CHAT LOGIC FUNCTIONS ---

function init() {
  const langSelect = document.getElementById('langSelect');

  if (langSelect) {
    // 🔁 Restore last selected language
    chrome.storage.local.get([LANG_STORAGE_KEY], (result) => {
      if (result[LANG_STORAGE_KEY]) {
        currentLang = result[LANG_STORAGE_KEY];
        langSelect.value = currentLang;
      } else {
        currentLang = langSelect.value; // fallback
      }

      applyCurrentLangToRecognition();
    });

    // 💾 Save language on change
    langSelect.addEventListener('change', () => {
      currentLang = langSelect.value;
      chrome.storage.local.set({ [LANG_STORAGE_KEY]: currentLang });
      applyCurrentLangToRecognition();
    });
  }

  initializeVoiceRecognition(); 

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', handleKeyPress);
  messageInput.addEventListener('input', updateCharCount);
  clearBtn.addEventListener('click', clearChat);
  // ===============================
  micBtn.addEventListener('click', startVoiceInput);
  
  chatArea.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-btn');
    if (!btn) return;

    const question = btn.getAttribute('data-question');
    if (!question) return;

    messageInput.value = question;
    sendMessage();
  });

  
  messageInput.addEventListener('input', autoResize);
  
  loadChat();
}

async function sendMessage() {
  const message = messageInput.value.trim();

  // 🚫 EMPTY INPUT VALIDATION
  if (message === '') {
    showInputWarning();
    messageInput.focus();
    return;
  }

  // 🔐 LANGUAGE LOCK ENFORCEMENT (CRITICAL)
  if (!isTextInSelectedLanguage(message, currentLang)) {
    const langWarnings = {
      "en-IN": "⚠️ Please ask the question only in the selected language.",
      "hi-IN": "⚠️ कृपया प्रश्न फक्त निवडलेल्या भाषेत विचारा.",
      "mr-IN": "⚠️ कृपया प्रश्न फक्त निवडलेल्या भाषेत विचारा.",
      "ta-IN": "⚠️ தயவுசெய்து தேர்ந்தெடுத்த மொழியில் மட்டும் கேள்வி கேளுங்கள்.",
      "te-IN": "⚠️ దయచేసి ఎంపిక చేసిన భాషలో మాత్రమే ప్రశ్న అడగండి.",
      "kn-IN": "⚠️ ದಯವಿಟ್ಟು ಆಯ್ಕೆ ಮಾಡಿದ ಭಾಷೆಯಲ್ಲಿ ಮಾತ್ರ ಪ್ರಶ್ನೆ ಕೇಳಿ.",
      "bn-IN": "⚠️ অনুগ্রহ করে নির্বাচিত ভাষাতেই প্রশ্ন করুন।"
    };

    addMessage(langWarnings[currentLang], 'bot');
    return; // ❌ DO NOT SEND TO BACKEND
  }

  // ✅ SAFE TO PROCEED
  addMessage(message, 'user');
  scrollToBottom(true);

  messageInput.value = '';
  updateCharCount();
  autoResize();

  showProfessionalLoading();

  try {
    const response = await fetch(`${BACKEND_URL}/ask_question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: message,
        lang: currentLang
      })
    });

    const result = await response.json();
    hideTyping();

    if (response.ok) {
      await addMessage(result.answer, 'bot', {
        references: result.references || []
      });
      scrollToBottom(true);
    } else {
      addMessage(`🤖 AI Error: ${result.error}`, 'bot');
    }

  } catch (error) {
    hideTyping();
    addMessage(
      `❌ Connection Error: Failed to get response from server.`,
      'bot'
    );
    console.error(error);
  }
}



// --- PERSISTENCE AND RENDERING FUNCTIONS ---

async function addMessage(text, type, meta = {}) {
    const result = await chrome.storage.local.get([CHAT_STORAGE_KEY]);
    const history = result[CHAT_STORAGE_KEY] || [];

    if (history.length === 0 && chatArea.querySelector('.welcome-card')) {
        chatArea.innerHTML = '';
    }
    
    renderMessage(text, type, meta); 

    history.push({ text, type, meta });
    await saveChat(history);
}

async function loadChat() {
  const result = await chrome.storage.local.get([CHAT_STORAGE_KEY]);
  const history = result[CHAT_STORAGE_KEY] || [];
  
  chatArea.innerHTML = ''; 

  if (history.length === 0) {
    chatArea.innerHTML = `
      <div class="welcome-card">
        <div class="welcome-icon">🏦</div>
        <h3>Welcome to Trust Fintech Q&A!</h3>
        <p>Your AI assistant is ready. Ask questions based on 50 pre-indexed banking documents using text or voice (🎤).</p>
      </div>
    `;
  }
 else {
    history.forEach(item => {
      renderMessage(item.text, item.type, item.meta); 
    });
  }
  scrollToBottom();
}

async function saveChat(history) {
    await chrome.storage.local.set({ [CHAT_STORAGE_KEY]: history });
}

// --- EVERYTHING ABOVE IS THE SAME ---
function renderMessage(text, type, meta = {}) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-bubble ${type}-bubble`;

  const formatted = formatMarkdown(text);

  // --------- CLEAN CITATION BLOCK ----------
// --------- PROFESSIONAL DOCUMENT REFERENCES ----------
  let sourceHtml = "";

  if (meta.references && Array.isArray(meta.references) && meta.references.length > 0) {
    sourceHtml = `
      <div class="ref-mini-box">
        <div class="ref-title">📚 References</div>
        ${meta.references.map(ref => {
          let file = ref.pdf || "";

          
          if (file.includes("aHR0") || file.length > 40) {
            file = "";
          }

          if (file.includes(".pdf")) {
            file = file.split("/").pop();
          }

          const page = ref.page || "—";
          
          if (!file && (!page || page === "—")) {
            return "";
          }

          return `
            <div class="ref-line">
              • <span class="ref-file">${file}</span>
              ${ref.section ? `<span class="ref-page">• ${ref.section}</span>` : ""}
              ${page && page !== "—" ? `<span class="ref-page">• Page ${page}</span>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }


  else if (meta.source) {
    sourceHtml = `<span class="source">📚 ${meta.source}</span>`;
  }
  // -----------------------------------------

  if (type === "bot") {
    messageDiv.innerHTML = `
      <div class="message-content">${formatted}</div>

      <div class="citations">
        ${sourceHtml}
      </div>

      <div class="message-meta">
        <span class="time">${getCurrentTime()}</span>
      </div>
    `;

    // 🔊 Replay button
    const replayBtn = document.createElement("button");
    replayBtn.className = "icon-btn";
    replayBtn.textContent = "🔊";
    replayBtn.title = "Replay audio";
    replayBtn.onclick = () => speakResponse(text, replayBtn);

    const metaDiv = messageDiv.querySelector(".message-meta");
    if (metaDiv) metaDiv.prepend(replayBtn);

  } else {
    messageDiv.innerHTML = `
      <div class="message-content">${formatted}</div>
      <div class="message-meta">
        <span class="time">${getCurrentTime()}</span>
      </div>
    `;
  }

  chatArea.appendChild(messageDiv);
  scrollToBottom();

  messageDiv.style.opacity = "0";
  messageDiv.style.transform = "translateY(10px)";
  setTimeout(() => {
    messageDiv.style.transition = "all 0.3s ease";
    messageDiv.style.opacity = "1";
    messageDiv.style.transform = "translateY(0)";
  }, 10);
}

function showProfessionalLoading() {
  const stages = [
    "Processing request…",
    "Searching relevant documents…",
    "Generating response…"
  ];

  let index = 0;

  // Clear previous timer if any
  if (loadingStageTimer) {
    clearInterval(loadingStageTimer);
    loadingStageTimer = null;
  }

  // Show first stage
  showTyping(stages[index]);

  loadingStageTimer = setInterval(() => {
    index++;

    if (index < stages.length) {
      // Show next stage (every 3 seconds)
      showTyping(stages[index]);
    } else {
      // After "Generating response…" (3 sec done)
      showTyping("Still processing — thank you for your patience");
      clearInterval(loadingStageTimer);
      loadingStageTimer = null;
    }
  }, 3000); // ⏱️ exactly 3 seconds per stage
}


// --- EVERYTHING BELOW IS THE SAME ---


function showTyping(customText) {
  const typingText = document.querySelector('.typing-text');
  typingText.textContent = customText;
  typingIndicator.style.display = 'flex';
}


function hideTyping() {
  if (loadingStageTimer) {
    clearInterval(loadingStageTimer);
    loadingStageTimer = null;
  }

  if (!isListening) {
    typingIndicator.style.display = 'none';
  }
}


function handleKeyPress(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function updateCharCount() {
  const length = messageInput.value.length;
  charCount.textContent = `${length} / 500`;
  charCount.style.color = length > 450 ? '#ff4444' : '#7ba5b8';
}

function autoResize() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
}

function scrollToBottom() {
  const messages = chatArea.querySelectorAll(".chat-bubble");
  const last = messages[messages.length - 1];

  if (!last) return;

  requestAnimationFrame(() => {
    last.scrollIntoView({
      behavior: "auto",
      block: "start"
    });
  });
}



function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function updateStatusBar(status) {
    const statusBar = document.querySelector('.status-text');
    statusBar.textContent = `• Happy to Help `;
}

async function clearChat() {
  if (confirm('Clear all messages?')) {
    await chrome.storage.local.set({ [CHAT_STORAGE_KEY]: [] });
    loadChat();
  }
}

// 🔥 CRITICAL FIX: Reset TTS when popup loses focus or closes
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        forceStopTts();
    }
});

window.addEventListener("blur", () => {
    forceStopTts();
});

window.addEventListener("beforeunload", () => {
    forceStopTts();
});

function forceStopTts() {
    try {
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            audioPlayer.src = "";
        }
    } catch (e) {
        console.warn("Audio cleanup error", e);
    }

    isSpeaking = false;

    if (activeTtsButton) {
        activeTtsButton.textContent = "🔊";
        activeTtsButton.title = "Replay audio";
        activeTtsButton.disabled = false;
        activeTtsButton = null;
    }

    if (audioPlayer) {
        audioPlayer.onended = null;
    }
}

// ================================
// 🔴 GLOBAL TTS STOP BUTTON LOGIC
// ================================

// 🔴 GLOBAL TTS STOP BUTTON
const globalTtsStopBtn = document.getElementById('globalTtsStop');
if (globalTtsStopBtn) {
  globalTtsStopBtn.addEventListener('click', stopAllTtsCompletely);
}


function stopAllTtsCompletely() {
  try {
    // Stop audio immediately
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
      audioPlayer.src = '';
      audioPlayer.onended = null;
    }
  } catch (e) {
    console.warn('TTS stop error:', e);
  }

  // Reset speaking state
  isSpeaking = false;

  // Reset active 🔊 button if any
  if (activeTtsButton) {
    activeTtsButton.textContent = '🔊';
    activeTtsButton.title = 'Replay audio';
    activeTtsButton.disabled = false;
    activeTtsButton = null;
  }
}