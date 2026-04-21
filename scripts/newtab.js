/**

* FocusTab - FINAL newtab.js (Stable + Store Ready)
  */

// ================= QUOTES =================
const QUOTES = [
{ text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
{ text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
{ text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
{ text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" }
];

// ================= STATE =================
let state = {
timerInterval: null,
timeLeft: 25 * 60,
isRunning: false,
totalTime: 25 * 60,
settings: {
theme: 'dark',
timerDuration: 25,
showQuotes: true
}
};

// ================= INIT =================
document.addEventListener('DOMContentLoaded', () => {
initializeExtension();


// 🔥 FIX: ensure streak always renders
setTimeout(() => {
    initializeStreak();
}, 200);


});

function initializeExtension() {
loadSettings(() => {
applyTheme();
updateClock();
updateGreeting();
displayRandomQuote();
loadFocusInput();
setupEventListeners();
updateTimerDisplay();
});


setInterval(() => {
    updateClock();
    updateGreeting();
}, 1000);


}

// ================= STORAGE =================
function loadSettings(callback) {
chrome.storage.local.get('focusTabSettings', (res) => {
if (res.focusTabSettings) {
state.settings = { ...state.settings, ...res.focusTabSettings };
}
state.totalTime = state.settings.timerDuration * 60;
state.timeLeft = state.totalTime;
callback && callback();
});
}

function saveSettings() {
chrome.storage.local.set({ focusTabSettings: state.settings });
}

function loadFocusInput() {
chrome.storage.local.get('todaysFocus', (res) => {
if (res.todaysFocus) {
document.getElementById('focusInput').value = res.todaysFocus;
}
});
}

function saveFocusInput() {
const val = document.getElementById('focusInput').value.trim();
if (val) chrome.storage.local.set({ todaysFocus: val });
}

// ================= CLOCK =================
function updateClock() {
const now = new Date();
document.getElementById('clock').textContent =
`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

function updateGreeting() {
const hour = new Date().getHours();
let g = "Good Morning", m = "Start your day with purpose!";
if (hour >= 12 && hour < 17) {
g = "Good Afternoon";
m = "Keep pushing—you’re doing great!";
} else if (hour >= 17) {
g = "Good Evening";
m = "Finish strong!";
}


document.getElementById('greeting').textContent = g;
document.getElementById('motivationalMessage').textContent = m;

}

// ================= QUOTES =================
function displayRandomQuote() {
if (!state.settings.showQuotes) return;
const q = QUOTES[Math.floor(Math.random()*QUOTES.length)];
document.getElementById('quoteText').textContent = q.text;
document.getElementById('quoteAuthor').textContent = `— ${q.author}`;
}

// ================= TIMER =================
function updateTimerDisplay() {
const m = Math.floor(state.timeLeft/60);
const s = state.timeLeft%60;
document.getElementById('timerDisplay').textContent =
`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function startTimer() {
if (state.isRunning) return;
state.isRunning = true;


state.timerInterval = setInterval(()=>{
    if(state.timeLeft>0){
        state.timeLeft--;
        updateTimerDisplay();
    } else completeTimer();
},1000);


}

function pauseTimer(){
state.isRunning=false;
clearInterval(state.timerInterval);
}

function resetTimer(){
pauseTimer();
state.timeLeft=state.totalTime;
updateTimerDisplay();
}

function completeTimer(){
resetTimer();
alert("Focus session complete!");
}

// ================= EVENTS =================
function setupEventListeners() {
document.getElementById('startBtn').onclick = startTimer;
document.getElementById('pauseBtn').onclick = pauseTimer;
document.getElementById('resetBtn').onclick = resetTimer;


document.getElementById('focusInput').addEventListener('blur', saveFocusInput);

document.getElementById('themeSelect').addEventListener('change', (e)=>{
    state.settings.theme = e.target.value;
    applyTheme();
    saveSettings();
});

}

// ================= THEME =================
function applyTheme() {
document.body.className = state.settings.theme;
}

// ================= STREAK =================
function initializeStreak() {
const today = new Date().toDateString();


chrome.storage.local.get('focusTabStreak', (result) => {

    let streakData = result.focusTabStreak || {
        streak: 1,
        lastSessionDate: today
    };

    if (streakData.lastSessionDate !== today) {
        if (streakData.lastSessionDate === getYesterdayDate()) {
            streakData.streak++;
        } else {
            streakData.streak = 1;
        }

        streakData.lastSessionDate = today;
        chrome.storage.local.set({ focusTabStreak: streakData });
    }

    displayStreak(streakData.streak);
});


}

function getYesterdayDate() {
const y = new Date();
y.setDate(y.getDate() - 1);
return y.toDateString();
}

function displayStreak(count) {
let el = document.getElementById('streakDisplay');


if (!el) {
    el = document.createElement('div');
    el.id = 'streakDisplay';
    document.body.appendChild(el);
}

el.innerHTML = `🔥 ${count} day${count !== 1 ? 's' : ''} streak`;

Object.assign(el.style, {
    position: 'fixed',
    top: '20px',
    left: '20px',
    zIndex: '9999',
    color: '#ff6b00',
    background: 'rgba(0,0,0,0.3)',
    padding: '8px 14px',
    borderRadius: '20px',
    fontWeight: '700',
    backdropFilter: 'blur(10px)'
});


}

console.log("FocusTab Ready 🚀");
