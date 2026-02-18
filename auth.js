// Password protection dengan SHA-256 hash
// JANGAN tulis password asli di sini - hanya hash yang aman
const PASSWORD_HASHES = [
    "9210b1fd76d104cbf27555f862919a53e64cd382059dd4b23e4e5ec852c287e5"
];

// Rate limiting configuration
const RATE_LIMIT = {
    maxAttempts: 5,         // Max attempts before lockout
    lockoutDuration: 60000, // Lockout duration in ms (60 seconds)
    attempts: 0,
    lockoutUntil: 0
};

// Fungsi untuk hash password menggunakan SHA-256
async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Cek apakah user sudah login
function isAuthenticated() {
    const authToken = sessionStorage.getItem('authToken');
    return PASSWORD_HASHES.includes(authToken);
}

// Check if rate limited
function isRateLimited() {
    if (Date.now() < RATE_LIMIT.lockoutUntil) {
        return true;
    }
    // Reset attempts after lockout expires
    if (RATE_LIMIT.lockoutUntil > 0 && Date.now() >= RATE_LIMIT.lockoutUntil) {
        RATE_LIMIT.attempts = 0;
        RATE_LIMIT.lockoutUntil = 0;
    }
    return false;
}

// Get remaining lockout seconds
function getRemainingLockout() {
    const remaining = Math.ceil((RATE_LIMIT.lockoutUntil - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
}

// Fungsi login with rate limiting
async function login(password) {
    // Check rate limit
    if (isRateLimited()) {
        return { success: false, rateLimited: true, remaining: getRemainingLockout() };
    }

    const hashedInput = await hashPassword(password);
    if (PASSWORD_HASHES.includes(hashedInput)) {
        RATE_LIMIT.attempts = 0;
        RATE_LIMIT.lockoutUntil = 0;
        sessionStorage.setItem('authToken', hashedInput);
        return { success: true };
    }

    // Failed attempt
    RATE_LIMIT.attempts++;
    if (RATE_LIMIT.attempts >= RATE_LIMIT.maxAttempts) {
        RATE_LIMIT.lockoutUntil = Date.now() + RATE_LIMIT.lockoutDuration;
    }

    return {
        success: false,
        rateLimited: false,
        attemptsLeft: RATE_LIMIT.maxAttempts - RATE_LIMIT.attempts
    };
}

// Fungsi logout
function logout() {
    sessionStorage.removeItem('authToken');
    location.reload();
}

// Inisialisasi proteksi saat halaman dimuat
document.addEventListener('DOMContentLoaded', function () {
    const mainContent = document.querySelector('main');
    const header = document.querySelector('header');

    if (!isAuthenticated()) {
        // Sembunyikan konten utama
        if (mainContent) mainContent.style.display = 'none';
        if (header) header.style.display = 'none';

        // Tampilkan halaman login
        showLoginPage();
    } else {
        // Tambahkan tombol logout di header
        addLogoutButton();
    }
});

// Tampilkan halaman login
function showLoginPage() {
    const loginHTML = `
        <div id="login-overlay" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: 'Inter', sans-serif;
        ">
            <div style="
                background: white;
                border-radius: 20px;
                padding: 3rem 2.5rem;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                width: 90%;
                max-width: 420px;
                animation: slideUp 0.4s ease-out;
            ">
                <div style="text-align: center; margin-bottom: 2rem;">
                    <i class="fas fa-lock" style="
                        font-size: 3.5rem;
                        color: #667eea;
                        margin-bottom: 1rem;
                    "></i>
                    <h2 style="
                        font-size: 1.875rem;
                        font-weight: 700;
                        color: #1f2937;
                        margin-bottom: 0.5rem;
                    ">Project Board AT</h2>
                    <p style="
                        color: #6b7280;
                        font-size: 0.95rem;
                    ">Masukkan password untuk melanjutkan</p>
                </div>
                
                <form id="login-form" style="display: flex; flex-direction: column; gap: 1.25rem;">
                    <div>
                        <label for="password-input" style="
                            display: block;
                            font-size: 0.875rem;
                            font-weight: 600;
                            color: #374151;
                            margin-bottom: 0.5rem;
                        ">Password</label>
                        <input 
                            type="password" 
                            id="password-input" 
                            placeholder="Masukkan password"
                            autocomplete="current-password"
                            style="
                                width: 100%;
                                padding: 0.875rem 1rem;
                                border: 2px solid #e5e7eb;
                                border-radius: 12px;
                                font-size: 1rem;
                                transition: all 0.2s;
                                outline: none;
                            "
                            onfocus="this.style.borderColor='#667eea'; this.style.boxShadow='0 0 0 3px rgba(102,126,234,0.1)';"
                            onblur="this.style.borderColor='#e5e7eb'; this.style.boxShadow='none';"
                        />
                    </div>
                    
                    <div id="error-message" style="
                        display: none;
                        padding: 0.875rem;
                        background: #fef2f2;
                        border: 1px solid #fecaca;
                        border-radius: 10px;
                        color: #dc2626;
                        font-size: 0.875rem;
                        text-align: center;
                    ">
                        <i class="fas fa-exclamation-circle"></i>
                        <span id="error-text">Password salah, silakan coba lagi</span>
                    </div>
                    
                    <button 
                        type="submit"
                        id="login-submit-btn"
                        style="
                            width: 100%;
                            padding: 1rem;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            border: none;
                            border-radius: 12px;
                            font-size: 1rem;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.3s;
                            box-shadow: 0 4px 15px rgba(102,126,234,0.4);
                        "
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(102,126,234,0.5)';"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(102,126,234,0.4)';"
                    >
                        <i class="fas fa-sign-in-alt" style="margin-right: 0.5rem;"></i>
                        Masuk
                    </button>
                </form>
                
                <div style="
                    margin-top: 1.5rem;
                    padding-top: 1.5rem;
                    border-top: 1px solid #e5e7eb;
                    text-align: center;
                ">
                    <p style="
                        font-size: 0.8rem;
                        color: #9ca3af;
                    ">
                        <i class="fas fa-shield-alt"></i>
                        Koneksi Anda dilindungi
                    </p>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(30px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        </style>
    `;

    document.body.insertAdjacentHTML('beforeend', loginHTML);

    // Handle form submit
    document.getElementById('login-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const passwordInput = document.getElementById('password-input');
        const errorMessage = document.getElementById('error-message');
        const errorText = document.getElementById('error-text');
        const submitBtn = document.getElementById('login-submit-btn');
        const password = passwordInput.value;

        // Disable button during login attempt
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';

        const result = await login(password);

        if (result.success) {
            // Login sukses, hapus overlay dan tampilkan konten
            document.getElementById('login-overlay').remove();
            const mainContent = document.querySelector('main');
            const header = document.querySelector('header');
            if (mainContent) mainContent.style.display = 'block';
            if (header) header.style.display = 'block';
            addLogoutButton();
        } else if (result.rateLimited) {
            // Rate limited - show lockout message with countdown
            errorMessage.style.display = 'block';
            passwordInput.value = '';
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.5';
            submitBtn.style.cursor = 'not-allowed';

            const updateCountdown = () => {
                const secs = getRemainingLockout();
                if (secs > 0) {
                    errorText.innerHTML = `<i class="fas fa-ban"></i> Terlalu banyak percobaan! Coba lagi dalam <strong>${secs} detik</strong>`;
                    submitBtn.innerHTML = `<i class="fas fa-clock" style="margin-right: 0.5rem;"></i> Tunggu ${secs}s`;
                    setTimeout(updateCountdown, 1000);
                } else {
                    errorMessage.style.display = 'none';
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                    submitBtn.innerHTML = '<i class="fas fa-sign-in-alt" style="margin-right: 0.5rem;"></i> Masuk';
                    passwordInput.focus();
                }
            };
            updateCountdown();
        } else {
            // Login gagal, tampilkan pesan error
            errorMessage.style.display = 'block';
            if (result.attemptsLeft <= 2) {
                errorText.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Password salah! <strong>${result.attemptsLeft} percobaan tersisa</strong>`;
            } else {
                errorText.innerHTML = '<i class="fas fa-exclamation-circle"></i> Password salah, silakan coba lagi';
            }
            passwordInput.value = '';
            passwordInput.focus();
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';

            // Animasi shake
            passwordInput.style.animation = 'shake 0.5s';
            setTimeout(() => {
                passwordInput.style.animation = '';
            }, 500);
        }
    });

    // Auto focus ke input password
    setTimeout(() => {
        document.getElementById('password-input').focus();
    }, 100);
}

// Tambahkan tombol logout
function addLogoutButton() {
    const nav = document.querySelector('header nav .flex.items-center.gap-3');
    if (nav && !document.getElementById('logout-btn')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logout-btn';
        logoutBtn.className = 'p-2 rounded-full bg-gray-100 hover:bg-gray-200';
        logoutBtn.title = 'Logout';
        logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
        logoutBtn.addEventListener('click', function () {
            if (confirm('Apakah Anda yakin ingin keluar?')) {
                logout();
            }
        });
        nav.insertBefore(logoutBtn, nav.firstChild);
    }
}

// Tambahkan CSS untuk animasi shake
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);
