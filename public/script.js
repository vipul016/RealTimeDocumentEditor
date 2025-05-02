const socket = io();
let currentRoom = '';
let userName = '';
let isTyping = false;
let typingTimeout;
let lastContent = '';
let typingUsers = new Set();
let lastSavedTime = null;
let autoSaveInterval;
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
let userColors = {};
let activeUsers = new Map();
let lastCursorPositions = new Map();

// DOM Elements
const joinForm = document.getElementById('joinForm');
const editorContainer = document.getElementById('editorContainer');
const editor = document.getElementById('editor');
const cursors = document.getElementById('cursors');
const usersList = document.getElementById('usersList');
const currentRoomSpan = document.getElementById('currentRoom');
const typingIndicator = document.getElementById('typingIndicator');
const copyRoomIdBtn = document.getElementById('copyRoomId');
const leaveRoomBtn = document.getElementById('leaveRoom');
const lastSavedSpan = document.getElementById('lastSaved');
const userCountSpan = document.getElementById('userCount');
const toast = document.getElementById('toast');

// Add socket connection error handling
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    showToast('Connection error. Please refresh the page.', 'error');
});

socket.on('connect', () => {
    console.log('Connected to server');
    if (currentRoom && userName) {
        // Rejoin room if we were previously in one
        socket.emit('join', { room: currentRoom, userName: userName });
    }
});

function getRandomColor() {
    return colors[Math.floor(Math.random() * colors.length)];
}

function joinRoom() {
    userName = document.getElementById('userName').value.trim();
    currentRoom = document.getElementById('roomId').value.trim();
    
    if (!userName) {
        showToast('Please enter your name', 'error');
        return;
    }
    
    if (!currentRoom) {
        currentRoom = generateRoomId();
        showToast(`Created new room: ${currentRoom}`, 'success');
    }

    // Assign a random color to the user
    userColors[userName] = getRandomColor();

    socket.emit('join', { room: currentRoom, userName: userName });
    joinForm.style.display = 'none';
    editorContainer.style.display = 'flex';
    currentRoomSpan.textContent = currentRoom;
    
    // Start auto-save
    startAutoSave();
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function leaveRoom() {
    if (confirm('Are you sure you want to leave this room?')) {
        socket.emit('leave', { room: currentRoom, userName });
        window.location.reload();
    }
}

copyRoomIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom)
        .then(() => {
            showToast('Room ID copied to clipboard!', 'success');
        })
        .catch(err => {
            showToast('Failed to copy room ID', 'error');
            console.error('Failed to copy: ', err);
        });
});

function showToast(message, type = 'info') {
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function formatText(command) {
    document.execCommand(command, false, null);
    const button = event.currentTarget;
    button.classList.add('active');
    setTimeout(() => button.classList.remove('active'), 200);
}

function formatHeading(level) {
    document.execCommand('formatBlock', false, `h${level}`);
    const button = event.currentTarget;
    button.classList.add('active');
    setTimeout(() => button.classList.remove('active'), 200);
}

function insertLink() {
    const url = prompt('Enter URL:');
    if (url) {
        document.execCommand('createLink', false, url);
    }
}

function insertImage() {
    const url = prompt('Enter image URL:');
    if (url) {
        document.execCommand('insertImage', false, url);
    }
}

function insertTable() {
    const rows = prompt('Enter number of rows:', '3');
    const cols = prompt('Enter number of columns:', '3');
    
    if (rows && cols) {
        let table = '<table border="1" style="border-collapse: collapse; width: 100%;">';
        
        for (let i = 0; i < rows; i++) {
            table += '<tr>';
            for (let j = 0; j < cols; j++) {
                table += '<td style="padding: 8px;">Cell</td>';
            }
            table += '</tr>';
        }
        
        table += '</table>';
        document.execCommand('insertHTML', false, table);
    }
}

function insertCodeBlock() {
    const code = prompt('Enter code:');
    if (code) {
        const codeBlock = `<pre><code>${code}</code></pre>`;
        document.execCommand('insertHTML', false, codeBlock);
    }
}

function insertQuote() {
    const quote = prompt('Enter quote:');
    if (quote) {
        const quoteBlock = `<blockquote>${quote}</blockquote>`;
        document.execCommand('insertHTML', false, quoteBlock);
    }
}

function clearFormatting() {
    document.execCommand('removeFormat', false, null);
}

function downloadDocument() {
    const content = editor.innerHTML;
    socket.emit('downloadDocument', { room: currentRoom, content });
}

function saveDocument() {
    const content = editor.innerHTML;
    socket.emit('saveDocument', { room: currentRoom, content });
    updateLastSaved();
    showToast('Document saved!', 'success');
}

function startAutoSave() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }
    
    autoSaveInterval = setInterval(() => {
        const content = editor.innerHTML;
        socket.emit('saveDocument', { room: currentRoom, content });
        updateLastSaved();
    }, 30000);
}

function updateLastSaved() {
    const now = new Date();
    lastSavedTime = now;
    lastSavedSpan.textContent = `Last saved: ${now.toLocaleTimeString()}`;
}

// Debounce function to limit update frequency
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Add this function to maintain cursor positions
function maintainCursorPositions() {
    // Store all cursor positions before content update
    const cursorElements = cursors.querySelectorAll('.cursor');
    const storedPositions = new Map();
    
    cursorElements.forEach(cursor => {
        const cursorUserName = cursor.getAttribute('data-user');
        if (cursorUserName && cursorUserName !== userName) {
            const transform = cursor.style.transform;
            const match = transform.match(/translate\(([\d.]+)px,\s*([\d.]+)px\)/);
            if (match) {
                storedPositions.set(cursorUserName, {
                    x: parseFloat(match[1]),
                    y: parseFloat(match[2])
                });
            }
        }
    });
    
    return storedPositions;
}

// Add version control for content updates
let documentVersion = 0;
let pendingUpdates = [];

// Optimize content update function with version control
const updateContent = debounce((content) => {
    if (content !== lastContent) {
        const selection = window.getSelection();
        let position = 0;
        
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            position = getCaretPosition(range.startContainer, range.startOffset);
        }
        
        // Send content update to server
        socket.emit('contentUpdate', { 
            room: currentRoom, 
            content: content,
            userName: userName,
            version: documentVersion,
            position: position,
            timestamp: Date.now()
        });
        
        lastContent = content;
    }
}, 25); // Reduced debounce time for faster updates

// Function to get caret position as character offset
function getCaretPosition(node, offset) {
    const range = document.createRange();
    range.setStart(editor, 0);
    range.setEnd(node, offset);
    return range.toString().length;
}

// Function to set caret position by character offset
function setCaretPosition(position) {
    const selection = window.getSelection();
    const range = document.createRange();
    let currentPos = 0;
    let found = false;
    
    function traverse(node) {
        if (found) return;
        
        if (node.nodeType === Node.TEXT_NODE) {
            const length = node.length;
            if (currentPos + length >= position) {
                range.setStart(node, position - currentPos);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                found = true;
                return;
            }
            currentPos += length;
        } else {
            for (let i = 0; i < node.childNodes.length; i++) {
                traverse(node.childNodes[i]);
            }
        }
    }
    
    traverse(editor);
}

// Editor event listeners
editor.addEventListener('input', (e) => {
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing', { room: currentRoom, userName });
    }   
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('stopTyping', { room: currentRoom, userName });
    }, 1000);

    // Update content with version control
    updateContent(editor.innerHTML);
});

// Update content update handler to preserve cursor positions
socket.on('contentUpdate', (data) => {
    if (data.userName !== userName) {
        // Store current cursor positions
        const storedPositions = maintainCursorPositions();
        
        // Save current cursor position and selection
        const selection = window.getSelection();
        let currentPosition = null;
        let currentRange = null;
        
        if (selection.rangeCount > 0) {
            currentRange = selection.getRangeAt(0).cloneRange();
            currentPosition = getCurrentCursorPosition();
        }
        
        // Update content only if it's different
        if (editor.innerHTML !== data.content) {
            // Update document version
            documentVersion = Math.max(documentVersion, data.version) + 1;
            
            // Update content
            editor.innerHTML = data.content;
            
            // Restore cursor position and selection
            if (currentPosition && currentRange) {
                // Try to restore the exact selection
                try {
                    selection.removeAllRanges();
                    selection.addRange(currentRange);
                } catch (e) {
                    // If exact restoration fails, try to restore by offset
                    setCaretPosition(currentPosition.offset);
                }
            }
            
            // Restore other users' cursors
            storedPositions.forEach((position, userName) => {
                const cursor = document.querySelector(`[data-user="${userName}"]`);
                if (cursor) {
                    cursor.style.transform = `translate(${position.x}px, ${position.y}px)`;
                }
            });
        }
    }
});

// Update cursor position tracking
let cursorPositions = new Map();
let lastCursorUpdate = 0;
const CURSOR_UPDATE_THROTTLE = 16; // ~60fps for smooth updates

// Function to get the current cursor position
function getCurrentCursorPosition() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        
        return {
            x: rect.left - editorRect.left + (rect.width / 2),
            y: rect.top - editorRect.top,
            offset: getCaretPosition(range.startContainer, range.startOffset)
        };
    }
    return null;
}

// Function to update cursor position
function updateCursorPosition(event) {
    const now = Date.now();
    if (now - lastCursorUpdate < CURSOR_UPDATE_THROTTLE) {
        return; // Throttle cursor updates
    }
    lastCursorUpdate = now;
    
    const editorRect = editor.getBoundingClientRect();
    const position = {
        x: event.clientX - editorRect.left,
        y: event.clientY - editorRect.top,
        offset: getCaretPosition(event.target, event.target.selectionStart || 0)
    };
    
    // Don't show local cursor, only emit position to server
    socket.emit('cursorMove', {
        room: currentRoom,
        userName,
        position: position,
        color: userColors[userName] || getRandomColor()
    });
}

// Update cursor position on mouse move and selection change
editor.addEventListener('mousemove', updateCursorPosition);
editor.addEventListener('mouseenter', updateCursorPosition);
editor.addEventListener('mouseleave', () => {
    socket.emit('cursorMove', {
        room: currentRoom,
        userName,
        position: null,
        color: userColors[userName] || getRandomColor()
    });
});

// Update cursor display logic
socket.on('cursorMove', (data) => {
    if (data.userName !== userName) {
        let cursor = document.querySelector(`[data-user="${data.userName}"]`);
        
        if (!data.position) {
            // Remove cursor if user's mouse left the editor
            if (cursor) {
                cursor.remove();
            }
            return;
        }
        
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.className = 'cursor';
            cursor.setAttribute('data-user', data.userName);
            
            // Create username label
            const label = document.createElement('div');
            label.className = 'cursor-label';
            label.textContent = data.userName;
            cursor.appendChild(label);
            
            cursors.appendChild(cursor);
        }
        
        // Update cursor position and color with smooth transition
        cursor.style.transform = `translate(${data.position.x}px, ${data.position.y}px)`;
        cursor.style.setProperty('--user-color', data.color);
        
        // Store the last known position for this user
        cursorPositions.set(data.userName, data.position);
    }
});

// Add MutationObserver to track content changes
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (!mutation.target.isContentEditable) return;
        
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(editor);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        const start = preSelectionRange.toString().length;
        
        localStorage.setItem('cursorPosition', start);
    });
});

observer.observe(editor, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true
});

// Socket event handlers
socket.on('userJoined', (data) => {
    console.log('User joined:', data.userName);
    
    // Create user badge
    const userBadge = document.createElement('div');
    userBadge.className = 'user-badge';
    userBadge.innerHTML = `
        <i class="fas fa-user"></i>
        <span>${data.userName}</span>
    `;
    usersList.appendChild(userBadge);
    
    // Update user count
    updateUserCount();
    
    // Show notification
    showToast(`${data.userName} joined the room`, 'info');
    
    // Create cursor for new user
    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.setAttribute('data-user', data.userName);
    
    // Create username label
    const label = document.createElement('div');
    label.className = 'cursor-label';
    label.textContent = data.userName;
    cursor.appendChild(label);
    
    cursors.appendChild(cursor);
});

socket.on('userLeft', (data) => {
    console.log('User left:', data.userName);
    
    // Remove user badge
    const userBadges = usersList.getElementsByClassName('user-badge');
    for (let badge of userBadges) {
        if (badge.querySelector('span').textContent === data.userName) {
            badge.remove();
            break;
        }
    }
    
    // Remove user's cursor
    const cursor = document.querySelector(`[data-user="${data.userName}"]`);
    if (cursor) {
        cursor.remove();
    }
    
    // Update typing indicator
    typingUsers.delete(data.userName);
    updateTypingIndicator();
    
    // Update user count
    updateUserCount();
    
    // Show notification
    showToast(`${data.userName} left the room`, 'info');
});

socket.on('userTyping', (data) => {
    if (data.userName !== userName) {
        typingUsers.add(data.userName);
        updateTypingIndicator();
        
        // Show typing cursor for the user
        showTypingCursor(data.userName);
    }
});

socket.on('userStoppedTyping', (data) => {
    if (data.userName !== userName) {
        typingUsers.delete(data.userName);
        updateTypingIndicator();
        
        // Remove typing cursor for the user
        removeTypingCursor(data.userName);
    }
});

socket.on('roomUsers', (users) => {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.innerHTML = `
            <span class="user-dot" style="background-color: ${userColors[user] || getRandomColor()}"></span>
            <span class="user-name">${user}</span>
        `;
        userList.appendChild(userItem);
    });
    
    // Update user count
    const userCount = document.getElementById('userCount');
    userCount.textContent = `${users.length} user${users.length !== 1 ? 's' : ''} in room`;
});

socket.on('documentContent', (data) => {
    const blob = new Blob([data.content], { type: 'text/html' });
    
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `document-${currentRoom}.html`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(a.href);
    
    showToast('Document downloaded successfully!', 'success');
});

function updateTypingIndicator() {
    if (typingUsers.size > 0) {
        const users = Array.from(typingUsers);
        let text = '';
        
        if (users.length === 1) {
            text = `${users[0]} is typing...`;
        } else if (users.length === 2) {
            text = `${users[0]} and ${users[1]} are typing...`;
        } else {
            text = `${users[0]} and ${users.length - 1} others are typing...`;
        }
        
        typingIndicator.textContent = text;
        typingIndicator.style.display = 'block';
    } else {
        typingIndicator.style.display = 'none';
    }
}

function updateUserCount() {
    const count = usersList.children.length + 1;
    userCountSpan.textContent = `${count} user${count !== 1 ? 's' : ''}`;
}

// Add visual feedback for active formatting
editor.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const parentElement = range.commonAncestorContainer.parentElement;
        
        document.querySelectorAll('.toolbar button').forEach(button => {
            button.classList.remove('active');
        });
        
        if (parentElement) {
            if (parentElement.tagName === 'B' || parentElement.tagName === 'STRONG') {
                document.querySelector('[title="Bold"]').classList.add('active');
            }
            if (parentElement.tagName === 'I' || parentElement.tagName === 'EM') {
                document.querySelector('[title="Italic"]').classList.add('active');
            }
            if (parentElement.tagName === 'U') {
                document.querySelector('[title="Underline"]').classList.add('active');
            }
            if (parentElement.tagName === 'STRIKE' || parentElement.tagName === 'S') {
                document.querySelector('[title="Strikethrough"]').classList.add('active');
            }
            if (parentElement.tagName.match(/^H[1-6]$/)) {
                document.querySelector(`[title="Heading ${parentElement.tagName[1]}"]`).classList.add('active');
            }
        }
    }
});

// Function to show typing cursor
function showTypingCursor(userName) {
    let cursor = document.querySelector(`[data-user="${userName}"]`);
    if (!cursor) {
        cursor = document.createElement('div');
        cursor.className = 'cursor typing-cursor';
        cursor.setAttribute('data-user', userName);
        
        // Create username label
        const label = document.createElement('div');
        label.className = 'cursor-label';
        label.textContent = userName;
        cursor.appendChild(label);
        
        cursors.appendChild(cursor);
    }
    
    // Add typing animation class
    cursor.classList.add('typing');
    
    // Position the cursor at the last known position or at the bottom of the editor
    const lastPosition = cursorPositions.get(userName);
    if (lastPosition) {
        cursor.style.transform = `translate(${lastPosition.x}px, ${lastPosition.y}px)`;
    } else {
        const editorRect = editor.getBoundingClientRect();
        cursor.style.transform = `translate(${editorRect.width / 2}px, ${editorRect.height - 30}px)`;
    }
    
    // Set the user's color
    cursor.style.setProperty('--user-color', userColors[userName] || getRandomColor());
}

// Function to remove typing cursor
function removeTypingCursor(userName) {
    const cursor = document.querySelector(`[data-user="${userName}"]`);
    if (cursor) {
        cursor.classList.remove('typing');
    }
}