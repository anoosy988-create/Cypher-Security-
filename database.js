require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');

const LOCAL_FILE = './local_db.json';
let localData = {};

if (fs.existsSync(LOCAL_FILE)) {
    try { localData = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { localData = {}; }
}

function saveLocal() {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(localData, null, 2), 'utf8');
}

/* ─── MongoDB (Mongoose) ─── */
const guildSchema = new mongoose.Schema({
    _id: String,
    logChannel: String,
    vanityProtection: Boolean,
    vanityURL: String
}, { _id: false });

const Guild = mongoose.model('Guild', guildSchema);

async function connectMongo() {
    if (!process.env.MONGODB_URI) return;
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ [DB] MongoDB connected — settings will persist on restart.');
    } catch (err) {
        console.error('❌ [DB] MongoDB failed, using local files:', err.message);
    }
}
connectMongo();

async function updateGuild(guildId, update) {
    if (mongoose.connection.readyState !== 1) return;
    await Guild.findByIdAndUpdate(guildId, update, { upsert: true });
}

function getLogChannel(guildId) {
    return localData[guildId]?.logChannel || null;
}

async function setLogChannel(guildId, channelId) {
    if (!localData[guildId]) localData[guildId] = {};
    localData[guildId].logChannel = channelId;
    saveLocal();
    await updateGuild(guildId, { logChannel: channelId });
}

async function toggleVanityProtection(guildId, enabled) {
    if (!localData[guildId]) localData[guildId] = {};
    localData[guildId].vanityProtection = enabled;
    saveLocal();
    await updateGuild(guildId, { vanityProtection: enabled });
}

function isVanityProtectionEnabled(guildId) {
    return !!localData[guildId]?.vanityProtection;
}

async function setVanityURL(guildId, url) {
    if (!localData[guildId]) localData[guildId] = {};
    localData[guildId].vanityURL = url;
    saveLocal();
    await updateGuild(guildId, { vanityURL: url });
}

function getVanityURL(guildId) {
    return localData[guildId]?.vanityURL || null;
}

/* ─── Sync from MongoDB on startup ─── */
setTimeout(async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
        const docs = await Guild.find({}).lean();
        for (const doc of docs) {
            if (!localData[doc._id]) localData[doc._id] = {};
            if (doc.logChannel) localData[doc._id].logChannel = doc.logChannel;
            if (doc.vanityProtection) localData[doc._id].vanityProtection = doc.vanityProtection;
            if (doc.vanityURL) localData[doc._id].vanityURL = doc.vanityURL;
        }
        saveLocal();
        console.log('✅ [DB] Synced', docs.length, 'guilds from MongoDB.');
    } catch (e) {}
}, 3000);

module.exports = {
    getLogChannel,
    setLogChannel,
    toggleVanityProtection,
    isVanityProtectionEnabled,
    setVanityURL,
    getVanityURL
};
