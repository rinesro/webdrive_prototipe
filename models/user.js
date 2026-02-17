const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email:    { type: String, required: true, unique: true, trim: true },
    password_encrypted: { type: String, required: true },
    aes_key_encrypted: { type: String, required: true },
    role:     { type: String, default: "End user" },
    hak_akses: { type: [String], default: ["Select", "Insert", "Update", "Delete"] }
}, {
    timestamps: true 
});

module.exports = mongoose.model('User', userSchema);