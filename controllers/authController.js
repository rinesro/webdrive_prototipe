const User = require('../models/user');
const Item = require('../models/item'); 
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb'); 
const crypto = require('crypto');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');


let bucket;
mongoose.connection.once('open', () => {
    bucket = new GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads' 
    });
    console.log("GridFS Bucket di authController siap digunakan.");
});


const privateKeyPem = fs.readFileSync(path.join(__dirname, '../kunci/private.pem'), 'utf8');
const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
const publicKeyPem = fs.readFileSync(path.join(__dirname, '../kunci/public.pem'), 'utf8');
const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);



exports.getRegisterPage = (req, res) => {
    res.render('register', { message: '', success: false });
};


exports.getLoginPage = (req, res) => {
    res.render('login', { message: '' });
};


exports.getUploadPage = async (req, res) => {
    try {
        const userId = req.session.user.id;

        
        const folders = await Item.find({ 
            pemilik_id: userId, 
            parent_id: null, 
            tipe: 'folder' 
        }).sort({ nama: 1 });

        
        const filesCursor = bucket.find({ 
            'metadata.pemilik_id': new mongoose.Types.ObjectId(userId), 
            'metadata.parent_id': null 
        });
        const files = await filesCursor.toArray();

        
        res.render('drive', { 
            user: req.session.user, 
            items: [...folders, ...files].sort((a, b) => (a.filename || a.nama).localeCompare(b.filename || b.nama)),
            currentFolder: null, 
            parentLink: '/'
        });

    } catch(err) {
        console.error("Error saat memuat halaman upload:", err);
        res.status(500).send("Gagal memuat halaman utama.");
    }
};


exports.getProfilePage = (req, res) => {
    
    res.render('profile', { user: req.session.user });
};



exports.registerUser = async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.render('register', { message: 'Semua field harus diisi.', success: false });
    }
    try {
        const userExists = await User.findOne({ $or: [{ username }, { email }] });
        if (userExists) {
            return res.render('register', { message: 'Username atau email sudah dipakai.', success: false });
        }
        const aesKey = crypto.randomBytes(32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
        let encrypted = cipher.update(password, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const encryptedPassword = iv.toString('base64') + ':' + encrypted;
        const aesKeyEncrypted = forge.util.encode64(publicKey.encrypt(aesKey.toString('binary'), 'RSA-OAEP'));
        await User.create({
            username,
            email,
            password_encrypted: encryptedPassword,
            aes_key_encrypted: aesKeyEncrypted,
        });
        res.render('register', {
            message: 'Registrasi berhasil! Anda akan dialihkan ke halaman login.',
            success: true
        });
    } catch (err) {
        console.error(err);
        res.render('register', { message: 'Terjadi error saat registrasi.', success: false });
    }
};


exports.loginUser = async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.render('login', { message: 'Username dan password wajib diisi.' });
    }
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.render('login', { message: 'User tidak ditemukan.' });
        }
        const aesKeyEncrypted = forge.util.decode64(user.aes_key_encrypted);
        const aesKey = Buffer.from(privateKey.decrypt(aesKeyEncrypted, 'RSA-OAEP'), 'binary');
        const [ivBase64, encryptedPasswordBase64] = user.password_encrypted.split(':');
        const iv = Buffer.from(ivBase64, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
        let decrypted = decipher.update(encryptedPasswordBase64, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        if (decrypted !== password) {
            return res.render('login', { message: 'Password salah.' });
        }
        
        req.session.user = {
            id: user._id,
            username: user.username,
            email: user.email
        };
        
        res.redirect('/upload');
    } catch (err) {
        console.error(err);
        res.render('login', { message: 'Terjadi error saat login.' });
    }
};


exports.logoutUser = (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error("Gagal logout:", err);
            return res.redirect('/');
        }
        res.clearCookie('connect.sid'); 
        res.redirect('/login');
    });
};
