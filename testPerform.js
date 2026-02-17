const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance, PerformanceObserver } = require('perf_hooks');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { v4: uuidv4 } = require('uuid'); // Menggunakan UUID untuk membuat data unik

const NUM_ITERATIONS = 5;
const MONGO_URI = "mongodb+srv://san:4XSWpzJMUUqJAPX2@cluster0.3ikdvzy.mongodb.net/";

const publicKey = fs.readFileSync(path.join(__dirname, 'kunci', 'public.pem'));
const privateKey = fs.readFileSync(path.join(__dirname, 'kunci', 'private.pem'));

const smallUserData = {
    username: 'benchmark_user',
    email: 'benchmark@test.com',
    password: 'supersecretpassword123'
};

const LARGE_FILE_SIZE_MB = 5;
const EXTRA_LARGE_FILE_SIZE_MB = 17;
const largeSampleData = crypto.randomBytes(LARGE_FILE_SIZE_MB * 1024 * 1024);
const extraLargeSampleData = crypto.randomBytes(EXTRA_LARGE_FILE_SIZE_MB * 1024 * 1024);

const UserBenchmarkSchema = new mongoose.Schema({ data: String, is_encrypted: Boolean });
const UserBenchmarkModel = mongoose.model('UserBenchmark', UserBenchmarkSchema);

const LargeFileSchema = new mongoose.Schema({ filename: String, content: Buffer });
const LargeFileModel = mongoose.model('LargeFile', LargeFileSchema);

function encryptObject(plainObject) {
    const dataBuffer = Buffer.from(JSON.stringify(plainObject), 'utf8');
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    const encryptedData = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
    const encryptedAesKey = crypto.publicEncrypt(publicKey, aesKey);
    return {
        encryptedData: encryptedData.toString('base64'),
        encryptedAesKey: encryptedAesKey.toString('base64'),
        iv: iv.toString('base64')
    };
}

function decryptObject(payload) {
    const encryptedData = Buffer.from(payload.encryptedData, 'base64');
    const encryptedAesKey = Buffer.from(payload.encryptedAesKey, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const aesKey = crypto.privateDecrypt(privateKey, encryptedAesKey);
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    const decryptedData = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return JSON.parse(decryptedData.toString('utf8'));
}

function encryptBuffer(dataBuffer) {
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
    const encryptedData = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
    const encryptedAesKey = crypto.publicEncrypt(publicKey, aesKey);
    return { encryptedData, encryptedAesKey, iv };
}

function decryptBuffer(payload) {
    const { encryptedData, encryptedAesKey, iv } = payload;
    const aesKey = crypto.privateDecrypt(privateKey, encryptedAesKey);
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

async function runBenchmarkSmallDocument() {
    // Simulasi dengan Enkripsi
    const uniqueEncryptedData = {
        username: `benchmark_user_${uuidv4()}`, // Menambahkan UUID untuk memastikan data unik saat enkripsi
        email: `benchmark_${uuidv4()}@test.com`,
        password: 'supersecretpassword123'
    };

    performance.mark('small-create-enc-start');
    const encryptedPayload = encryptObject(uniqueEncryptedData);
    const userEnc = new UserBenchmarkModel({ data: encryptedPayload.encryptedData, is_encrypted: true });
    await userEnc.save();
    performance.mark('small-create-enc-end');
    performance.measure('[Dokumen Kecil] Create dengan Enkripsi', 'small-create-enc-start', 'small-create-enc-end');

    performance.mark('small-read-enc-start');
    const foundUserEnc = await UserBenchmarkModel.findById(userEnc._id).lean(); // Menggunakan .lean() untuk menghindari cache
    decryptObject({ encryptedData: foundUserEnc.data, ...encryptedPayload });
    performance.mark('small-read-enc-end');
    performance.measure('[Dokumen Kecil] Read dengan Dekripsi', 'small-read-enc-start', 'small-read-enc-end');
    await UserBenchmarkModel.findByIdAndDelete(userEnc._id);

    // Simulasi tanpa Enkripsi dengan data unik
    const uniqueNoEncryptedData = {
        username: `benchmark_user_noenc_${uuidv4()}`, // Menambahkan UUID untuk memastikan data unik saat tanpa enkripsi
        email: `benchmark_noenc_${uuidv4()}@test.com`,
        password: 'supersecretpassword123'
    };

    performance.mark('small-create-noenc-start');
    const userNoEnc = new UserBenchmarkModel({ data: JSON.stringify(uniqueNoEncryptedData), is_encrypted: false });
    await userNoEnc.save();
    performance.mark('small-create-noenc-end');
    performance.measure('[Dokumen Kecil] Create tanpa Enkripsi', 'small-create-noenc-start', 'small-create-noenc-end');

    performance.mark('small-read-noenc-start');
    await UserBenchmarkModel.findById(userNoEnc._id).lean(); // Menggunakan .lean() untuk menghindari cache
    performance.mark('small-read-noenc-end');
    performance.measure('[Dokumen Kecil] Read tanpa Dekripsi', 'small-read-noenc-start', 'small-read-noenc-end');
    await UserBenchmarkModel.findByIdAndDelete(userNoEnc._id);
}

async function runBenchmarkLargeDocument_NoGridFS() {
    const uniqueLargeEncryptedData = crypto.randomBytes(LARGE_FILE_SIZE_MB * 1024 * 1024);
    const uniqueLargeNoEncryptedData = crypto.randomBytes(LARGE_FILE_SIZE_MB * 1024 * 1024);

    // Enkripsi dan simpan file besar
    performance.mark('large-doc-create-enc-start');
    const encryptedPayload = encryptBuffer(uniqueLargeEncryptedData);
    const largeFileEnc = new LargeFileModel({ filename: 'large_encrypted.bin', content: encryptedPayload.encryptedData });
    await largeFileEnc.save();
    performance.mark('large-doc-create-enc-end');
    performance.measure(`[Dokumen ${LARGE_FILE_SIZE_MB}MB] Create dengan Enkripsi`, 'large-doc-create-enc-start', 'large-doc-create-enc-end');
    
    performance.mark('large-doc-read-enc-start');
    const foundFileEnc = await LargeFileModel.findById(largeFileEnc._id).lean(); // Menggunakan .lean() untuk menghindari cache
    decryptBuffer({ encryptedData: foundFileEnc.content, ...encryptedPayload });
    performance.mark('large-doc-read-enc-end');
    performance.measure(`[Dokumen ${LARGE_FILE_SIZE_MB}MB] Read dengan Dekripsi`, 'large-doc-read-enc-start', 'large-doc-read-enc-end');
    await LargeFileModel.findByIdAndDelete(largeFileEnc._id);

    // Tanpa enkripsi dan simpan file besar
    performance.mark('large-doc-create-noenc-start');
    const largeFileNoEnc = new LargeFileModel({ filename: 'large_raw.bin', content: uniqueLargeNoEncryptedData });
    await largeFileNoEnc.save();
    performance.mark('large-doc-create-noenc-end');
    performance.measure(`[Dokumen ${LARGE_FILE_SIZE_MB}MB] Create tanpa Enkripsi`, 'large-doc-create-noenc-start', 'large-doc-create-noenc-end');

    performance.mark('large-doc-read-noenc-start');
    await LargeFileModel.findById(largeFileNoEnc._id).lean(); // Menggunakan .lean() untuk menghindari cache
    performance.mark('large-doc-read-noenc-end');
    performance.measure(`[Dokumen ${LARGE_FILE_SIZE_MB}MB] Read tanpa Dekripsi`, 'large-doc-read-noenc-start', 'large-doc-read-noenc-end');
    await LargeFileModel.findByIdAndDelete(largeFileNoEnc._id);
}

async function runBenchmarkExtraLargeDocument_WithGridFS() {
    const uniqueExtraLargeEncryptedData = crypto.randomBytes(EXTRA_LARGE_FILE_SIZE_MB * 1024 * 1024);
    const uniqueExtraLargeNoEncryptedData = crypto.randomBytes(EXTRA_LARGE_FILE_SIZE_MB * 1024 * 1024);

    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'benchmark_gridfs' });

    // Enkripsi dan simpan file besar
    performance.mark('grid-upload-enc-start');
    const encryptedPayload = encryptBuffer(uniqueExtraLargeEncryptedData);
    const uploadStreamEnc = bucket.openUploadStream('extra_large_encrypted.bin');
    uploadStreamEnc.end(encryptedPayload.encryptedData);
    const fileIdEnc = await new Promise(r => uploadStreamEnc.on('finish', () => r(uploadStreamEnc.id)));
    performance.mark('grid-upload-enc-end');
    performance.measure(`[GridFS ${EXTRA_LARGE_FILE_SIZE_MB}MB] Upload dengan Enkripsi`, 'grid-upload-enc-start', 'grid-upload-enc-end');

    performance.mark('grid-download-enc-start');
    const downloadStreamEnc = bucket.openDownloadStream(fileIdEnc);
    const chunksEnc = [];
    for await (const chunk of downloadStreamEnc) { chunksEnc.push(chunk); }
    decryptBuffer({ encryptedData: Buffer.concat(chunksEnc), ...encryptedPayload });
    performance.mark('grid-download-enc-end');
    performance.measure(`[GridFS ${EXTRA_LARGE_FILE_SIZE_MB}MB] Download dengan Dekripsi`, 'grid-download-enc-start', 'grid-download-enc-end');
    await bucket.delete(fileIdEnc);

    // Tanpa enkripsi dan simpan file besar
    performance.mark('grid-upload-noenc-start');
    const uploadStreamNoEnc = bucket.openUploadStream('extra_large_raw.bin');
    uploadStreamNoEnc.end(uniqueExtraLargeNoEncryptedData);
    const fileIdNoEnc = await new Promise(r => uploadStreamNoEnc.on('finish', () => r(uploadStreamNoEnc.id)));
    performance.mark('grid-upload-noenc-end');
    performance.measure(`[GridFS ${EXTRA_LARGE_FILE_SIZE_MB}MB] Upload tanpa Enkripsi`, 'grid-upload-noenc-start', 'grid-upload-noenc-end');
    
    performance.mark('grid-download-noenc-start');
    const downloadStreamNoEnc = bucket.openDownloadStream(fileIdNoEnc);
    const chunksNoEnc = [];
    for await (const chunk of downloadStreamNoEnc) { chunksNoEnc.push(chunk); }
    Buffer.concat(chunksNoEnc);
    performance.mark('grid-download-noenc-end');
    performance.measure(`[GridFS ${EXTRA_LARGE_FILE_SIZE_MB}MB] Download tanpa Dekripsi`, 'grid-download-noenc-start', 'grid-download-noenc-end');
    await bucket.delete(fileIdNoEnc);
}

async function main() {
    const results = {}; 

    const obs = new PerformanceObserver((items) => {
        const entry = items.getEntries()[0];
        if (!results[entry.name]) {
            results[entry.name] = [];
        }
        results[entry.name].push(entry.duration);
        performance.clearMarks(entry.name);
    });
    obs.observe({ entryTypes: ['measure'], buffered: true });

    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            readPreference: 'primary',  // Menggunakan primary node untuk query
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,  // Batasi ukuran pool koneksi agar tidak terpengaruh cache
            autoIndex: false, // Untuk menghindari penggunaan cache index
        });
        console.log("Koneksi ke MongoDB Atlas berhasil!");

        for (let i = 1; i <= NUM_ITERATIONS; i++) {
            console.log(`\n<<<<< MEMULAI ITERASI PENGUJIAN KE-${i} DARI ${NUM_ITERATIONS} >>>>>`);
            await runBenchmarkSmallDocument();
            await runBenchmarkLargeDocument_NoGridFS();
            await runBenchmarkExtraLargeDocument_WithGridFS();
            console.log(`<<<<< ITERASI KE-${i} SELESAI >>>>>`);
        }

    } catch (error) {
        console.error("Terjadi error selama benchmark:", error);
    } finally {
        await mongoose.disconnect();
        console.log("\nKoneksi ke MongoDB ditutup.");
        
        displayAnalysis(results);
        
        performance.clearMarks();
        obs.disconnect();
    }
}

function displayAnalysis(results) {
    console.log('\n--- ANALISIS AKHIR BENCHMARK (RATA-RATA DARI ' + NUM_ITERATIONS + ' ITERASI) ---');
    console.log('-'.repeat(115));
    console.log(
        'Operasi'.padEnd(50) + 
        '| Tanpa Enkripsi (ms)'.padEnd(25) + 
        '| Dengan Enkripsi (ms)'.padEnd(25) + 
        '| Overhead'
    );
    console.log('-'.repeat(115));

    const averages = {};
    for (const name in results) {
        const timings = results[name];
        averages[name] = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    }

    const processed = new Set();
    const sortedKeys = Object.keys(averages).sort();

    for (const name of sortedKeys) {
        if (processed.has(name)) continue;

        let baselineName, cryptoName;
        
        if (name.includes('tanpa')) {
            baselineName = name;
            cryptoName = name.replace('tanpa', 'dengan');
        } else if (name.includes('dengan')) {
            cryptoName = name;
            baselineName = name.replace('dengan', 'tanpa');
        } else {
            continue; 
        }

        if (averages[baselineName] && averages[cryptoName]) {
            const baselineAvg = averages[baselineName];
            const cryptoAvg = averages[cryptoName];
            const overhead = cryptoAvg - baselineAvg;
            const overheadPercent = overhead > 0 && baselineAvg > 0 ? (overhead / baselineAvg * 100) : 0;
            
            const cleanName = baselineName.replace('[', '').replace(']', '').replace('tanpa Enkripsi', '').replace('tanpa Dekripsi', '').trim();
            
            const nameCol = `${cleanName}`.padEnd(49);
            const baselineCol = `| ${baselineAvg.toFixed(2)}`.padEnd(24);
            const cryptoCol = `| ${cryptoAvg.toFixed(2)}`.padEnd(24);
            const overheadCol = `| ${overhead.toFixed(2)} ms (+${overheadPercent.toFixed(1)}%)`;

            console.log(`${nameCol} ${baselineCol} ${cryptoCol} ${overheadCol}`);

            processed.add(baselineName);
            processed.add(cryptoName);
        }
    }
    console.log('-'.repeat(115));
}

main().catch(console.error);
