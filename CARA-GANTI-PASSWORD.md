# Cara Mengganti Password

## Password Default
Password yang saat ini aktif:
1. **2401**
2. **0124**
3. **240199**

Ketiga password di atas dapat digunakan untuk login ke website.

## Cara Mengganti Password

Untuk mengganti password, Anda perlu mengubah hash password di file `auth.js`. Ikuti langkah-langkah berikut:

### Langkah 1: Generate Hash Password Baru

Buka browser (Chrome, Firefox, Edge, dll), tekan **F12** untuk membuka Developer Console, kemudian paste kode berikut dan tekan Enter:

```javascript
async function generatePasswordHash(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    console.log('Password:', password);
    console.log('Hash:', hashHex);
    return hashHex;
}

// Ganti "password_baru_anda" dengan password yang Anda inginkan
generatePasswordHash("password_baru_anda");
```

**Contoh:**
Jika ingin password baru adalah "project2026", ubah baris terakhir menjadi:
```javascript
generatePasswordHash("project2026");
```

### Langkah 2: Copy Hash yang Dihasilkan

Setelah menjalankan kode di atas, console akan menampilkan hash password. Copy hash tersebut (kode panjang seperti: `8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92`)

### Langkah 3: Update File auth.js

Buka file `auth.js` dan cari baris ini (biasanya di baris 3-4):

```javascript
const PASSWORD_HASH = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";
```

Ganti hash di dalam tanda kutip dengan hash password baru yang sudah Anda copy.

### Langkah 4: Simpan dan Upload ke GitHub

1. Simpan file `auth.js`
2. Commit dan push perubahan ke GitHub
3. Password baru Anda sudah aktif!

## Keamanan

✅ **Aman untuk GitHub**: Password tidak disimpan dalam bentuk plain text, melainkan dalam bentuk hash SHA-256

✅ **Tidak bisa di-reverse**: Hash tidak bisa di-convert kembali menjadi password asli

✅ **Session-based**: Login hanya tersimpan di session browser, akan hilang jika browser ditutup

## Contoh Hash Password Umum

Berikut beberapa contoh hash untuk referensi (JANGAN gunakan password ini):

- `123456` → `8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92`
- `password` → `5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8`
- `admin123` → `240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9`

## Troubleshooting

**Q: Lupa password, bagaimana cara reset?**

A: Cukup generate hash password baru dan update di file `auth.js` seperti langkah di atas.

**Q: Apakah bisa menggunakan password yang sama untuk beberapa pengguna?**

A: Sistem ini hanya mendukung satu password global. Untuk multi-user, perlu modifikasi lebih lanjut.

**Q: Apakah password aman di GitHub?**

A: Ya, karena yang tersimpan hanya hash-nya, bukan password asli. Orang lain tidak bisa tahu password Anda dari hash tersebut.
