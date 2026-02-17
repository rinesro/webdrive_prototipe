const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const { Readable } = require('stream');
const crypto = require('crypto');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const Item = require('../models/item');
const User = require('../models/user');
const archiver = require('archiver');
const { ObjectId } = require('mongoose').Types;


let bucket;
mongoose.connection.once('open', () => {
    bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
});
const privateKeyPem = fs.readFileSync(path.join(__dirname, '../kunci/private.pem'), 'utf8');
const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
const publicKeyPem = fs.readFileSync(path.join(__dirname, '../kunci/public.pem'), 'utf8');
const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);


exports.getDriveContents = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userIdObj = new mongoose.Types.ObjectId(userId);
        const folderId = req.params.folderId || null;

        let itemsToDisplay = [];
        let currentFolder = null;

        if (!folderId) {
            
            const folders = await Item.find({ pemilik_id: userIdObj, parent_id: null, tipe: 'folder' }).lean();
            const files = await mongoose.connection.db.collection('uploads.files').find({ 
                'metadata.pemilik_id': userIdObj, 
                'metadata.parent_id': null 
            }).toArray();
            
            itemsToDisplay = [...folders, ...files].map(item => ({...item, currentUserRole: 'owner' }));

        } else {
            
            const folderIdObj = new mongoose.Types.ObjectId(folderId);
            
            currentFolder = await Item.findOne({
                _id: folderIdObj,
                $or: [{ pemilik_id: userIdObj }, { 'shared_with.user_id': userIdObj }]
            }).lean();

            if (!currentFolder) {
                req.session.notification = { type: 'error', message: 'Folder tidak ditemukan atau Anda tidak memiliki akses.' };
                return res.redirect('/upload');
            }

            const folders = await Item.find({ parent_id: folderIdObj }).lean();
            const files = await mongoose.connection.db.collection('uploads.files').find({
                'metadata.parent_id': folderIdObj
            }).toArray();

            itemsToDisplay = [...folders, ...files];

            
            let roleInParentFolder = 'read';
            if (currentFolder.pemilik_id.equals(userIdObj)) {
                roleInParentFolder = 'owner';
            } else {
                
                const singleShare = currentFolder.shared_with.find(s => s.user_id.equals(userIdObj) && s.tipe_share === 'single');
                const anyShare = currentFolder.shared_with.find(s => s.user_id.equals(userIdObj));
                
                const shareInfo = singleShare || anyShare; 

                if (shareInfo) {
                    roleInParentFolder = shareInfo.role;
                }
            }

            itemsToDisplay.forEach(item => {
                item.currentUserRole = roleInParentFolder; 
            });
        }

        res.render('drive', {
            items: itemsToDisplay.sort((a, b) => (a.nama || a.filename).localeCompare(b.nama || b.filename)),
            currentFolder: currentFolder,
            user: req.session.user,
            parentLink: currentFolder?.parent_id ? `/folder/${currentFolder.parent_id}` : '/upload',
            searchQuery: ''
        });

    } catch (err) {
        console.error("Error di getDriveContents:", err);
        res.status(500).send('Gagal memuat isi drive');
    }
};

exports.createFolder = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { folderName, parent_id } = req.body;

        
        const parentIdObj = parent_id === "null" ? null : new mongoose.Types.ObjectId(parent_id);

        await Item.create({
            nama: folderName,
            tipe: 'folder',
            pemilik_id: new mongoose.Types.ObjectId(userId),
            parent_id: parentIdObj, 
            shared_with: [] 
        });

        res.redirect(parentIdObj ? `/folder/${parentIdObj}` : '/upload');
    } catch (err) {
        console.error(err);
        res.status(500).send('Gagal membuat folder');
    }
};


exports.uploadFile = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { parent_id } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).send('Tidak ada file yang diupload');
        }

        
        let inheritedShareData = [];
        const parentIdObj = parent_id ? new mongoose.Types.ObjectId(parent_id) : null;

        if (parentIdObj) {
            
            const parentFolder = await Item.findById(parentIdObj).lean();
            if (parentFolder && parentFolder.shared_with) {
                
                inheritedShareData = parentFolder.shared_with;
                console.log(`File mewarisi ${inheritedShareData.length} hak akses dari folder induk.`);
            }
        }
        

        const aesKey = crypto.randomBytes(32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
        const encryptedBuffer = Buffer.concat([cipher.update(file.buffer), cipher.final()]);

        const aesKeyEncrypted = forge.util.encode64(publicKey.encrypt(aesKey.toString('binary'), 'RSA-OAEP'));

        const readableStream = Readable.from(encryptedBuffer);
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
        const writestream = bucket.openUploadStream(file.originalname, {
            metadata: {
                pemilik_id: new mongoose.Types.ObjectId(userId),
                parent_id: parentIdObj,
                original_mimetype: file.mimetype,
                encrypted_aes_key: aesKeyEncrypted,
                iv: iv.toString('hex'),
                
                shared_with: inheritedShareData
            }
        });

        readableStream.pipe(writestream);

        writestream.on('finish', () => {
            res.redirect(parent_id ? `/folder/${parent_id}` : '/upload');
        });

        writestream.on('error', (err) => {
            console.error("Gagal saat menulis stream ke GridFS:", err);
            res.status(500).send('Gagal mengupload file');
        });

    } catch (err) {
        console.error("Error pada fungsi uploadFile:", err);
        res.status(500).send('Terjadi kesalahan pada server saat mengupload file');
    }
};
exports.getPreviewData = async (req, res) => {
    try {
        const file = await mongoose.connection.db.collection('uploads.files').findOne({ 
            _id: new mongoose.Types.ObjectId(req.params.id) 
        });

        if (!file) {
            return res.status(404).json({ supported: false, message: 'File tidak ditemukan.' });
        }

        const mimetype = file.metadata?.original_mimetype || file.contentType;
        const downloadUrl = `/download/${file._id}?preview=1`;

        
        if (mimetype.startsWith('image/')) {
            return res.json({
                supported: true,
                type: 'image',
                url: downloadUrl,
                filename: file.filename
            });
        }

        
        if (mimetype === 'application/pdf') {
            return res.json({
                supported: true,
                type: 'pdf',
                url: downloadUrl,
                filename: file.filename
            });
        }
        
        
        if (mimetype === 'text/plain') {
            
            const encryptedAesKey = file.metadata?.encrypted_aes_key;
            const ivHex = file.metadata?.iv;

            if (!encryptedAesKey || !ivHex) {
                return res.status(500).json({ supported: false, message: 'Metadata enkripsi tidak lengkap.' });
            }

            const decryptedAesKey = privateKey.decrypt(forge.util.decode64(encryptedAesKey), 'RSA-OAEP');
            const aesKey = Buffer.from(decryptedAesKey, 'binary');
            const iv = Buffer.from(ivHex, 'hex');

            const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
            const downloadStream = bucket.openDownloadStream(file._id);

            let encryptedData = [];
            downloadStream.on('data', chunk => encryptedData.push(chunk));
            downloadStream.on('end', () => {
                const encryptedBuffer = Buffer.concat(encryptedData);
                const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
                const decryptedText = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]).toString('utf8');
                
                return res.json({
                    supported: true,
                    type: 'text',
                    content: decryptedText,
                    filename: file.filename
                });
            });
            downloadStream.on('error', () => res.status(500).json({ supported: false, message: 'Gagal membaca file.'}));
            return;
        }

        return res.json({
            supported: false,
            message: `File "${file.filename}" tidak didukung untuk ditampilkan.`,
            filename: file.filename
        });

    } catch (err) {
        console.error("Error di getPreviewData:", err);
        res.status(500).json({ supported: false, message: 'Terjadi kesalahan pada server.' });
    }
};
exports.viewFile = async (req, res) => {
    try {
        let item = await Item.findById(req.params.id);
        if (item) {
            if (item.tipe === 'folder') {
                const items = await Item.find({ parent_id: item._id });
                return res.render('drive', { items, currentFolder: item });
            } else {
                return res.render('preview', { item });
            }
        }

        const file = await mongoose.connection.db.collection('uploads.files').findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
        if (!file) return res.status(404).send('Item tidak ditemukan');

        return res.render('preview', { item: file });
    } catch (err) {
        console.error(err);
        res.status(500).send('Terjadi kesalahan pada server');
    }
};
exports.searchItems = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userIdObj = new mongoose.Types.ObjectId(userId);
        const searchQuery = req.query.q || '';

        if (!searchQuery) {
            return res.redirect('/upload');
        }

        const searchRegex = new RegExp(searchQuery, 'i');

        const folders = await Item.find({ 
            nama: { $regex: searchRegex },
            tipe: 'folder',
            $or: [
                { pemilik_id: userIdObj },
                { 'shared_with.user_id': userIdObj }
            ]
        }).lean();
        folders.forEach(folder => {
            if (folder.pemilik_id && folder.pemilik_id.toString() === userId) {
                folder.currentUserRole = 'owner';
            } else {
                const shareInfo = folder.shared_with.find(s => s && s.user_id && s.user_id.toString() === userId);
                folder.currentUserRole = shareInfo ? shareInfo.role : 'read';
            }
        });

        const files = await mongoose.connection.db.collection('uploads.files').find({ 
            'filename': { $regex: searchRegex },
            $or: [
                { 'metadata.pemilik_id': userIdObj },
                { 'metadata.shared_with.user_id': userIdObj }
            ]
        }).toArray();
        files.forEach(file => {
            file.tipe = 'file';
            if (file.metadata.pemilik_id && file.metadata.pemilik_id.toString() === userId) {
                file.currentUserRole = 'owner';
            } else {
                const shareInfo = file.metadata.shared_with?.find(s => s && s.user_id && s.user_id.toString() === userId);
                file.currentUserRole = shareInfo ? shareInfo.role : 'read';
            }
        });

        const allItems = [...folders, ...files];

        
        res.render('drive', { 
            items: allItems,
            user: req.session.user,
            currentFolder: { nama: `Hasil Pencarian untuk: "${searchQuery}"` },
            parentLink: '/upload',
            searchQuery: searchQuery
        });

    } catch(err) {
        console.error("Error saat mencari item:", err);
        res.status(500).send("Gagal melakukan pencarian.");
    }
};
exports.downloadFile = async (req, res) => {
    try {
        
        const file = await mongoose.connection.db.collection('uploads.files').findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
        if (!file) return res.status(404).send('File tidak ditemukan');

        
        const encryptedAesKey = file.metadata?.encrypted_aes_key;
        const ivHex = file.metadata?.iv;
        if (!encryptedAesKey || !ivHex) return res.status(400).send('Metadata enkripsi tidak lengkap');

        
        const decryptedAesKey = privateKey.decrypt(forge.util.decode64(encryptedAesKey), 'RSA-OAEP');
        const aesKey = Buffer.from(decryptedAesKey, 'binary');
        const iv = Buffer.from(ivHex, 'hex');

        
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
        const downloadStream = bucket.openDownloadStream(file._id);

        let encryptedData = [];
        downloadStream.on('data', chunk => encryptedData.push(chunk));
        downloadStream.on('end', () => {
            const encryptedBuffer = Buffer.concat(encryptedData);

            
            const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
            let decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);

            
            const isPreview = req.query.preview === '1';
            res.set('Content-Type', file.metadata?.original_mimetype || file.contentType || 'application/octet-stream');
            res.set(
                'Content-Disposition',
                isPreview
                    ? 'inline; filename="' + file.filename + '"'
                    : 'attachment; filename="' + file.filename + '"'
            );
            res.send(decrypted);
        });
        downloadStream.on('error', err => {
            console.error(err);
            res.status(500).send('Terjadi kesalahan saat membaca file terenkripsi');
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Terjadi kesalahan saat mengunduh file');
    }
};

exports.uploadFolder = async (req, res) => {
    const { parent_id, folderName } = req.body;
    const files = req.files;
    const userId = req.session.user.id;
    const userIdObj = new mongoose.Types.ObjectId(userId);
    const MAX_FILE_COUNT = 100; 
    if (files.length > MAX_FILE_COUNT) {
        return res.status(400).json({ message: `Jumlah file tidak boleh lebih dari ${MAX_FILE_COUNT}.` });
    }

    for (const file of files) {
        
        if (file.originalname.split('/').length > 2) {
             return res.status(400).json({ message: 'Struktur folder tidak boleh memiliki sub-folder.' });
        }
    }

    if (!files || files.length === 0 || !folderName) {
        return res.status(400).send("File atau nama folder tidak boleh kosong.");
    }

    console.log(`Mulai mengupload folder "${folderName}" dengan ${files.length} file.`);

    try {
        const parentIdObj = parent_id ? new mongoose.Types.ObjectId(parent_id) : null;
        const folderCache = new Map();

        const rootFolder = await Item.create({
            nama: folderName,
            tipe: 'folder',
            pemilik_id: userIdObj,
            parent_id: parentIdObj,
        });
        console.log(`Folder utama "${folderName}" berhasil dibuat dengan ID: ${rootFolder._id}`);
        folderCache.set('', rootFolder._id);

        const originalRootName = files[0].originalname.split('/')[0];

        for (const file of files) {
            console.log(`\n--- Memproses file: ${file.originalname}`);

            const newRelativePath = file.originalname.includes('/') ? file.originalname.substring(originalRootName.length + 1) : file.originalname;
            
            
            if (!newRelativePath) {
                console.log(`--> Melewati file karena path relatif kosong.`);
                continue;
            }

            const pathParts = newRelativePath.split('/').slice(0, -1);
            let currentParentId = rootFolder._id;
            let currentPathForCache = '';

            for (const part of pathParts) {
                const newCacheKey = currentPathForCache ? `${currentPathForCache}/${part}` : part;
                if (!folderCache.has(newCacheKey)) {
                    console.log(`--> Membuat sub-folder baru: "${part}"`);
                    const newSubFolder = await Item.create({
                        nama: part,
                        tipe: 'folder',
                        pemilik_id: userIdObj,
                        parent_id: currentParentId,
                    });
                    folderCache.set(newCacheKey, newSubFolder._id);
                    currentParentId = newSubFolder._id;
                } else {
                    currentParentId = folderCache.get(newCacheKey);
                }
                currentPathForCache = newCacheKey;
            }

            const finalFileName = path.basename(file.originalname);
            console.log(`--> Menyimpan file "${finalFileName}" ke dalam folder ID: ${currentParentId}`);

            
            const aesKey = crypto.randomBytes(32);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
            const encryptedBuffer = Buffer.concat([cipher.update(file.buffer), cipher.final()]);
            const aesKeyEncrypted = forge.util.encode64(publicKey.encrypt(aesKey.toString('binary'), 'RSA-OAEP'));
            const readableStream = Readable.from(encryptedBuffer);
            const writestream = bucket.openUploadStream(finalFileName, {
                metadata: {
                    pemilik_id: userIdObj,
                    parent_id: currentParentId,
                    original_mimetype: file.mimetype,
                    encrypted_aes_key: aesKeyEncrypted,
                    iv: iv.toString('hex'),
                }
            });

            await new Promise((resolve, reject) => {
                writestream.on('finish', resolve);
                writestream.on('error', reject);
                readableStream.pipe(writestream);
            });
            console.log(`--> File "${finalFileName}" berhasil disimpan.`);
        }

        console.log("--- Proses upload folder selesai. Mengalihkan halaman. ---");
        res.redirect(parent_id ? `/folder/${parent_id}` : '/upload');

    } catch (err) {
        console.error("Gagal mengupload folder:", err);
        res.status(500).send("Gagal mengupload folder.");
    }
};

exports.deleteItem = async (req, res) => {
    try {
        const itemId = new ObjectId(req.params.id);
        const userId = new ObjectId(req.session.user.id);

        const item = await Item.findOne({ _id: itemId, pemilik_id: userId });

        
        if (item && item.tipe === 'folder') {
            await deleteFolderRecursively(itemId, bucket);
        } else {
            
            const file = await mongoose.connection.db.collection('uploads.files').findOne({ _id: itemId, 'metadata.pemilik_id': userId });
            if (file) {
                
                await bucket.delete(itemId);
            } else {
                
                return res.status(404).send('Item tidak ditemukan atau Anda tidak memiliki izin untuk menghapusnya.');
            }
        }
        
        showNotification(req, 'success', 'Item berhasil dihapus.');
        res.redirect(req.get('referer') || '/upload');

    } catch (err) {
        console.error("Error saat menghapus item:", err);
        showNotification(req, 'error', 'Gagal menghapus item.');
        res.status(500).redirect('back');
    }
};



exports.shareItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { shareWithEmail, role } = req.body;
        const sharerId = req.session.user.id;
        const sharerIdObj = new mongoose.Types.ObjectId(sharerId);
        const itemIdObj = new mongoose.Types.ObjectId(itemId);

        const targetUser = await User.findOne({ email: shareWithEmail });
        if (!targetUser) {
            req.session.notification = { type: 'error', message: 'Pengguna tidak ditemukan.' };
            
            return res.redirect(req.get('referer') || '/upload');
        }

        if (targetUser._id.equals(sharerIdObj)) {
            req.session.notification = { type: 'error', message: 'Anda tidak bisa berbagi ke diri sendiri.' };
            
            return res.redirect(req.get('referer') || '/upload');
        }

        let itemToShare = null;
        let isFolder = false;

        itemToShare = await Item.findById(itemIdObj);
        if (itemToShare) {
            isFolder = true;
        } else {
            const fileData = await mongoose.connection.db.collection('uploads.files').findOne({ _id: itemIdObj });
            if (fileData) {
                itemToShare = { ...fileData, ...fileData.metadata, _id: fileData._id };
            }
        }

        if (!itemToShare) {
            req.session.notification = { type: 'error', message: 'Item tidak ditemukan.' };
            
            return res.redirect(req.get('referer') || '/upload');
        }

        const isTheOwner = itemToShare.pemilik_id.equals(sharerIdObj);
        const isSharedAsOwner = itemToShare.shared_with?.some(s => s.user_id.equals(sharerIdObj) && s.role === 'owner');
        if (!isTheOwner && !isSharedAsOwner) {
            req.session.notification = { type: 'error', message: 'Anda tidak punya izin untuk berbagi item ini.' };
            
            return res.redirect(req.get('referer') || '/upload');
        }

        const currentShares = itemToShare.shared_with || [];
        const singleShareExists = currentShares.some(
            s => s.user_id.equals(targetUser._id) && s.tipe_share === 'single'
        );

        if (singleShareExists) {
            req.session.notification = { type: 'error', message: `Item ini sudah dibagikan secara langsung ke ${shareWithEmail}.` };
            
            return res.redirect(req.get('referer') || '/upload');
        }

        const newShareObject = { 
            user_id: targetUser._id, 
            role, 
            tipe_share: 'single'
        };

        if (isFolder) {
            await Item.updateOne({ _id: itemIdObj }, { $pull: { shared_with: { user_id: targetUser._id } } });
            await Item.updateOne({ _id: itemIdObj }, { $push: { shared_with: newShareObject } });
            await updatePermissionsRecursively(itemIdObj, targetUser._id, role);
        } else {
            await mongoose.connection.db.collection('uploads.files').updateOne({ _id: itemIdObj }, { $pull: { 'metadata.shared_with': { user_id: targetUser._id } } });
            await mongoose.connection.db.collection('uploads.files').updateOne({ _id: itemIdObj }, { $push: { 'metadata.shared_with': newShareObject } });
        }

        req.session.notification = { type: 'success', message: 'Item berhasil dibagikan!' };
        res.redirect(req.get('referer') || '/upload');

    } catch (error) {
        console.error("Error saat membagikan item:", error);
        req.session.notification = { type: 'error', message: 'Gagal membagikan item.' };
        
        res.status(500).redirect(req.get('referer') || '/upload');
    }
};


exports.renameItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { newName } = req.body;
        const userIdObj = new mongoose.Types.ObjectId(req.session.user.id);
        const itemIdObj = new mongoose.Types.ObjectId(itemId);

        if (!newName || newName.trim() === '') {
            return res.redirect('back');
        }

        let updateResult = { modifiedCount: 0 };
        let itemType = 'Item';

        
        updateResult = await Item.updateOne(
            { 
                _id: itemIdObj,
                $or: [
                    { pemilik_id: userIdObj },
                    { 'shared_with': { $elemMatch: { user_id: userIdObj, role: 'owner' } } }
                ]
            },
            { 
                $set: { nama: newName.trim() }
            }
        );
        itemType = 'Folder';

        
        if (updateResult.modifiedCount === 0) {
            updateResult = await mongoose.connection.db.collection('uploads.files').updateOne(
                { 
                    _id: itemIdObj,
                    $or: [
                        { 'metadata.pemilik_id': userIdObj },
                        { 'metadata.shared_with': { $elemMatch: { user_id: userIdObj, role: 'owner' } } }
                    ]
                },
                { 
                    $set: { filename: newName.trim() }
                }
            );
            itemType = 'File';
        }

        
        if (updateResult.modifiedCount > 0) {
            req.session.notification = { type: 'success', message: `${itemType} berhasil diubah namanya.` };
            res.redirect(req.get('referer') || '/upload');
        } else {
            
            return res.status(404).send("Item tidak ditemukan atau Anda tidak punya izin untuk mengubah namanya.");
        }

    } catch (err) {
        console.error("Error saat mengganti nama item:", err);
        req.session.notification = { type: 'error', message: 'Gagal mengganti nama.' };
        res.status(500).redirect('back');
    }
};
exports.getUserFolders = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const folders = await Item.find({ 
            pemilik_id: userId, 
            tipe: 'folder' 
        }).select('nama _id').lean(); 
        res.json(folders);
    } catch (err) {
        res.status(500).json({ message: 'Gagal memuat folder.' });
    }
};


exports.moveItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { destinationFolderId } = req.body;
        const userId = req.session.user.id;
        const userIdObj = new mongoose.Types.ObjectId(userId);

        const newParentId = (destinationFolderId === 'root') 
            ? null 
            : new mongoose.Types.ObjectId(destinationFolderId);

        if (itemId === destinationFolderId) {
            return res.status(400).send('Tidak bisa memindahkan folder ke dalam dirinya sendiri.');
        }

        let newParentPermissions = [];
        if (newParentId) {
            const newParentFolder = await Item.findById(newParentId).lean();
            if (newParentFolder) {
                newParentPermissions = newParentFolder.shared_with || [];
            }
        }

        
        let item = await Item.findById(itemId);
        let canMove = false;
        if (item) {
            
            if (item.pemilik_id.toString() === userId) canMove = true;
            
            const shareInfo = item.shared_with.find(s => s && s.user_id && s.user_id.toString() === userId && s.role === 'owner');
            if (shareInfo) canMove = true;
            if (canMove) {
                await Item.updateOne({ _id: itemId }, { $set: { parent_id: newParentId } });
                return res.redirect(req.get('referer') || '/upload');
            }
        }

        
        const file = await mongoose.connection.db.collection('uploads.files').findOne({ _id: new mongoose.Types.ObjectId(itemId) });
        if (file) {
            
            if (file.metadata.pemilik_id && file.metadata.pemilik_id.toString() === userId) canMove = true;
            
            const shareInfo = file.metadata.shared_with?.find(s => s && s.user_id && s.user_id.toString() === userId && s.role === 'owner');
            if (shareInfo) canMove = true;
            if (canMove) {
                await mongoose.connection.db.collection('uploads.files').updateOne(
                    { _id: new mongoose.Types.ObjectId(itemId) },
                    { $set: { 'metadata.parent_id': newParentId } }
                );
                return res.redirect(req.get('referer') || '/upload');
            }
        }
        return res.redirect(req.get('referer') || '/upload');

        return res.status(403).send('Anda tidak punya hak akses owner untuk memindahkan item ini.');
    } catch (err) {
        console.error("Error saat memindahkan item:", err);
        res.status(500).send("Gagal memindahkan item.");
    }
};

exports.getSharedWithMe = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const userIdObj = new mongoose.Types.ObjectId(userId);

        
        const queryCondition = {
            'shared_with': { 
                $elemMatch: { 
                    user_id: userIdObj, 
                    tipe_share: 'single' 
                } 
            }
        };

        const metadataQueryCondition = {
            'metadata.shared_with': {
                $elemMatch: {
                    user_id: userIdObj,
                    tipe_share: 'single'
                }
            }
        };

        const sharedFolders = await Item.find(queryCondition).lean();
        const sharedFiles = await mongoose.connection.db.collection('uploads.files')
                                    .find(metadataQueryCondition).toArray();
        

        const topLevelSharedItems = [...sharedFolders, ...sharedFiles];
        
        topLevelSharedItems.forEach(item => {
            const data = item.metadata || item;
            item.tipe = item.filename ? 'file' : 'folder';
            
            const shareInfo = data.shared_with.find(s => s.user_id.equals(userIdObj) && s.tipe_share === 'single');
            item.currentUserRole = shareInfo ? shareInfo.role : 'read';
        });
        
        res.render('drive', {
            items: topLevelSharedItems.sort((a, b) => (a.nama || a.filename).localeCompare(b.nama || b.filename)),
            currentFolder: { nama: 'Dibagikan kepada saya' }, 
            user: req.session.user,
            parentLink: '/upload', 
            searchQuery: ''
        });

    } catch (err) {
        console.error("Error di getSharedWithMe:", err);
        res.status(500).send('Gagal memuat item yang dibagikan.');
    }
};
exports.downloadFolder = async (req, res) => {
    try {
        const folderId = new mongoose.Types.ObjectId(req.params.id);
        const rootFolder = await Item.findById(folderId).lean();

        if (!rootFolder) {
            return res.status(404).send('Folder tidak ditemukan.');
        }
        
        
        res.attachment(`${rootFolder.nama}.zip`);

        const archive = archiver('zip', {
            zlib: { level: 9 } 
        });

        
        archive.on('error', (err) => {
            throw err;
        });

        
        archive.pipe(res);

        
        const getFiles = async (currentFolderId, pathPrefix) => {
            
            const filesInDir = await mongoose.connection.db.collection('uploads.files').find({ 'metadata.parent_id': currentFolderId }).toArray();
            
            for (const file of filesInDir) {
                
                const encryptedAesKey = file.metadata.encrypted_aes_key;
                const ivHex = file.metadata.iv;

                if (!encryptedAesKey || !ivHex) continue;  

                const decryptedAesKey = privateKey.decrypt(forge.util.decode64(encryptedAesKey), 'RSA-OAEP');
                const aesKey = Buffer.from(decryptedAesKey, 'binary');
                const iv = Buffer.from(ivHex, 'hex');

                
                const downloadStream = bucket.openDownloadStream(file._id);
                const chunks = [];
                for await (const chunk of downloadStream) {
                    chunks.push(chunk);
                }
                const encryptedBuffer = Buffer.concat(chunks);
                
                
                const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
                const decryptedBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
                
                
                archive.append(decryptedBuffer, { name: `${pathPrefix}${file.filename}` });
            }

            
            const subFolders = await Item.find({ parent_id: currentFolderId, tipe: 'folder' });
            for (const subFolder of subFolders) {
                await getFiles(subFolder._id, `${pathPrefix}${subFolder.nama}/`);
            }
        };

        
        await getFiles(folderId, '');
        
        
        archive.finalize();

    } catch (err) {
        console.error("Error saat download folder:", err);
        res.status(500).send('Gagal mendownload folder.');
    }
};

const deleteFolderRecursively = async (folderId, bucket) => {
    
    const filesToDelete = await mongoose.connection.db.collection('uploads.files').find({ 'metadata.parent_id': folderId }).toArray();
    for (const file of filesToDelete) {
        
        await bucket.delete(new ObjectId(file._id));
    }


    const subFolders = await Item.find({ parent_id: folderId });
    for (const subFolder of subFolders) {
        
        await deleteFolderRecursively(subFolder._id, bucket);
    }

    
    await Item.findByIdAndDelete(folderId);
};

const showNotification = (req, type, message) => {
    req.session.notification = { type, message };
};

const updatePermissionsRecursively = async (folderId, targetUserId, role) => {
    
    const newChildShare = { 
        user_id: targetUserId, 
        role, 
        tipe_share: 'child' 
    };

    
    const filesInDir = await mongoose.connection.db.collection('uploads.files').find({ 'metadata.parent_id': folderId }).toArray();
    for (const file of filesInDir) {
        
        await mongoose.connection.db.collection('uploads.files').updateOne(
            { _id: file._id },
            { 
                $pull: { 'metadata.shared_with': { user_id: targetUserId, tipe_share: 'child' } },
            }
        );
        
        await mongoose.connection.db.collection('uploads.files').updateOne(
            { _id: file._id },
            {
                $push: { 'metadata.shared_with': newChildShare }
            }
        );
    }
    
    
    const subFolders = await Item.find({ parent_id: folderId });
    for (const subFolder of subFolders) {
        
        await Item.updateOne(
            { _id: subFolder._id }, 
            { $pull: { shared_with: { user_id: targetUserId, tipe_share: 'child' } } }
        );
        
        await Item.updateOne(
            { _id: subFolder._id }, 
            { $push: { shared_with: newChildShare } }
        );

        
        await updatePermissionsRecursively(subFolder._id, targetUserId, role);
    }
};
const applyInheritedPermissions = async (itemId, isFolder, newParentPermissions) => {
    try {
        const itemIdObj = new mongoose.Types.ObjectId(itemId);

        
        const newChildPermissions = newParentPermissions.map(p => ({
            user_id: p.user_id,
            role: p.role,
            tipe_share: 'child' 
        }));

        if (isFolder) {
            

            
            await Item.updateOne(
                { _id: itemIdObj },
                { $pull: { shared_with: { tipe_share: 'child' } } }
            );

            
            if (newChildPermissions.length > 0) {
                await Item.updateOne(
                    { _id: itemIdObj },
                    { $push: { shared_with: { $each: newChildPermissions } } }
                );
            }

            
            const subFolders = await Item.find({ parent_id: itemIdObj, tipe: 'folder' }).lean();
            const filesInFolder = await mongoose.connection.db.collection('uploads.files').find({ 'metadata.parent_id': itemIdObj }).toArray();

            const childPromises = [];
            for (const subFolder of subFolders) {
                childPromises.push(applyInheritedPermissions(subFolder._id, true, newParentPermissions));
            }
            for (const file of filesInFolder) {
                childPromises.push(applyInheritedPermissions(file._id, false, newParentPermissions));
            }
            await Promise.all(childPromises);

        } else {
            
            const filesCollection = mongoose.connection.db.collection('uploads.files');

            
            await filesCollection.updateOne(
                { _id: itemIdObj },
                { $pull: { 'metadata.shared_with': { tipe_share: 'child' } } }
            );

            
            if (newChildPermissions.length > 0) {
                await filesCollection.updateOne(
                    { _id: itemIdObj },
                    { $push: { 'metadata.shared_with': { $each: newChildPermissions } } }
                );
            }
        }
    } catch (error) {
        console.error(`Gagal menerapkan hak akses untuk item ${itemId}:`, error);
        
        throw error;
    }
};