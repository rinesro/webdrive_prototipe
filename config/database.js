const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Koneksi ke MongoDB Atlas berhasil!");
    } catch (err) {
        console.error("Koneksi gagal:", err.message);
        
        process.exit(1);
    }
};

module.exports = connectDB;