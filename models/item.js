const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
    nama: { type: String, required: true },
    tipe: { type: String, required: true, enum: ['file', 'folder'] },
    pemilik_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    shared_with: [{
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        role: {
            type: String,
            enum: ['read', 'owner'],
            default: 'read',
            required: true
        },
        tipe_share: {
            type: String,
            enum: ['single', 'child'],
            required: true
        }
    }],
    metadata: {
        mimetype: String,
        size: Number
    },
    data_enkripsi: {
        encrypted_key: Buffer,
        iv: Buffer,
        tag: Buffer,
        ciphertext: Buffer
    }
}, { timestamps: true });

module.exports = mongoose.model('Folder', folderSchema);