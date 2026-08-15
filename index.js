require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    Colors,
    PermissionsBitField,
    AuditLogEvent,
    MessageFlags
} = require('discord.js');
const db = require('./database');

const OWNER_ID = process.env.OWNER_ID;

/* ─── Connect MongoDB ONCE ─── */
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('[✓] Connected to MongoDB');
        db.syncFromMongo();
    })
    .catch(err => console.error('[✗] MongoDB Error:', err.message));

/* ─── HTTP Server ─── */
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cypher is running');
});
server.listen(process.env.PORT || 3000, () => {
    console.log(`[HTTP] Server listening on port ${process.env.PORT || 3000}`);
});

/* ─── Discord Client ─── */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildInvites,
    ]
});

function getLogChannel(guild) {
    const id = db.getLogChannel(guild.id);
    return id ? guild.channels.cache.get(id) : null;
}

function logEmbed(title, fields, color = Colors.Blue) {
    const icon = client.user ? client.user.displayAvatarURL() : undefined;
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Cypher Protection System', iconURL: icon });
}

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/* ─── Warning System (MongoDB) ─── */
const warnSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    number: Number,
    reason: String,
    by: String,
    date: { type: Number, default: () => Date.now() }
});

const counterSchema = new mongoose.Schema({
    guildId: { type: String, unique: true },
    nextNumber: { type: Number, default: 1 }
});

const Warn = mongoose.model('Warn', warnSchema);
const Counter = mongoose.model('Counter', counterSchema);

async function getWarnings(guildId, userId) {
    return await Warn.find({ guildId, userId }).sort({ number: 1 }).lean();
}

async function getNextWarningNumber(guildId) {
    const counter = await Counter.findOneAndUpdate(
        { guildId },
        { $inc: { nextNumber: 1 } },
        { upsert: true, new: true }
    );
    return counter.nextNumber - 1;
}

async function addWarning(guildId, userId, reason, byId) {
    const number = await getNextWarningNumber(guildId);
    await Warn.create({ guildId, userId, number, reason, by: byId });
    return number;
}

async function removeWarning(guildId, userId, number) {
    const result = await Warn.deleteOne({ guildId, userId, number });
    return result.deletedCount > 0;
}

/* ─── Slash Commands ─── */
const slashCommands = [
    {
        name: 'setlog',
        description: 'تحديد روم لوق الحماية',
        type: 1,
        default_member_permissions: '8',
        options: [{
            name: 'channel', description: 'اختر روم اللوق',
            type: 7, channel_types: [0], required: true
        }]
    },
    {
        name: 'setvanity',
        description: 'تحديد رابط السيرفر المخصص للحماية',
        type: 1,
        default_member_permissions: '8',
        options: [{
            name: 'url', description: 'اكتب الرابط بدون discord.gg/ مثلاً: ab10',
            type: 3, required: true
        }]
    },
    {
        name: 'vanity-protect',
        description: 'تفعيل/تعطيل حماية رابط السيرفر',
        type: 1,
        default_member_permissions: '8',
        options: [{
            name: 'enabled', description: 'تفعيل أو تعطيل',
            type: 5, required: true
        }]
    },
    {
        name: 'settings',
        description: 'عرض إعدادات البوت الحالية',
        type: 1,
        default_member_permissions: '8'
    }
];

client.on('guildCreate', async (guild) => {
    try {
        await guild.commands.set(slashCommands);
        console.log(`[+] Slash commands registered in: ${guild.name}`);
    } catch (err) {
        console.error(`[-] Failed slash commands in ${guild.name}:`, err.message);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
        return interaction.reply({ content: 'هذا الأمر يعمل في السيرفرات فقط.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const { commandName } = interaction;
    const guildId = interaction.guild.id;
    const member = interaction.member;

    if (!isAdmin(member)) {
        return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'setlog') {
        const ch = interaction.options.getChannel('channel');
        db.setLogChannel(guildId, ch.id);
        return interaction.reply({ content: `✅ تم تحديد ${ch} روم اللوق.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'setvanity') {
        const url = interaction.options.getString('url')?.trim();
        db.setVanityURL(guildId, url);
        return interaction.reply({ content: `✅ تم تحديد رابط السيرفر: discord.gg/${url}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'vanity-protect') {
        const on = interaction.options.getBoolean('enabled');
        db.toggleVanityProtection(guildId, on);
        return interaction.reply({ content: on ? '✅ حماية الرابط مفعلة.' : '⚠️ معطلة.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'settings') {
        const logChId = db.getLogChannel(guildId);
        const logCh = logChId ? `<#${logChId}>` : 'غير محدد';
        const vanity = db.isVanityProtectionEnabled(guildId) ? '✅ مفعلة' : '⚠️ معطلة';
        const vanityURL = db.getVanityURL(guildId) || 'غير محدد';

        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعدادات البوت')
            .addFields(
                { name: '📝 روم اللوق', value: logCh, inline: true },
                { name: '🔗 الرابط', value: `discord.gg/${vanityURL}`, inline: true },
                { name: '🛡️ الحماية', value: vanity, inline: true }
            )
            .setColor(Colors.Gold)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

/* ─── Prefix Commands ─── */
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const args = message.content.trim().split(/\s+/);
    const cmd = args[0];
    if (!isAdmin(message.member)) return;

    const guildId = message.guild.id;

    if (cmd === 'ق') {
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
            const logCh = getLogChannel(message.guild);
            if (logCh) {
                await logCh.send({ embeds: [logEmbed('🔒 تم قفل الشات', [
                    { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
                    { name: '📢 القناة', value: `<#${message.channel.id}>`, inline: true },
                ], Colors.Red)] }).catch(() => {});
            }
            await message.reply('🔒 تم قفل الشات بنجاح.').catch(() => {});
        } catch (err) {
            await message.reply('❌ ما قدرت أقفل الشات.').catch(() => {});
        }
        return;
    }

    if (cmd === 'ف') {
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
            const logCh = getLogChannel(message.guild);
            if (logCh) {
                await logCh.send({ embeds: [logEmbed('🔓 تم فتح الشات', [
                    { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
                    { name: '📢 القناة', value: `<#${message.channel.id}>`, inline: true },
                ], Colors.Green)] }).catch(() => {});
            }
            await message.reply('🔓 تم فتح الشات بنجاح.').catch(() => {});
        } catch (err) {
            await message.reply('❌ ما قدرت أفتح الشات.').catch(() => {});
        }
        return;
    }

    if (cmd === 'تح') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ استخدم: `تح @العضو السبب`').catch(() => {});
        const reason = args.slice(2).join(' ');
        if (!reason) return message.reply('❌ اكتب سبب التحذير.').catch(() => {});

        try {
            const warnNumber = await addWarning(guildId, target.id, reason, message.author.id);
            const logCh = getLogChannel(message.guild);
            if (logCh) {
                await logCh.send({ embeds: [logEmbed('⚠️ تحذير جديد', [
                    { name: '👤 العضو', value: `<@${target.id}>`, inline: true },
                    { name: '⚡ بواسطة', value: `<@${message.author.id}>`, inline: true },
                    { name: '📋 السبب', value: reason, inline: false },
                    { name: '#️⃣ الرقم', value: `#${warnNumber}`, inline: true },
                ], Colors.Orange)] }).catch(() => {});
            }
            await message.reply(`⚠️ تم إعطاء التحذير #${warnNumber} لـ <@${target.id}>\n**السبب:** ${reason}`).catch(() => {});
        } catch (err) {
            console.error('[Warn Error]', err);
            await message.reply('❌ حصل خطأ في حفظ التحذير.').catch(() => {});
        }
        return;
    }

    if (cmd === 'شيل') {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply('❌ استخدم: `شيل @العضو #رقم`\nمثال: `شيل @Anas #2`').catch(() => {});
        }

        const numArg = args.find(a => a.startsWith('#'));
        if (!numArg) {
            return message.reply('❌ حدد رقم التحذير مثلاً: `#2`\nاستخدم: `شيل @العضو #رقم`').catch(() => {});
        }

        const number = parseInt(numArg.replace('#', ''));
        if (isNaN(number) || number < 1) {
            return message.reply('❌ الرقم غير صحيح. استخدم رقم صحيح مثل `#2`.').catch(() => {});
        }

        try {
            const deleted = await removeWarning(guildId, target.id, number);
            if (!deleted) {
                return message.reply(`⚠️ ما لقيت تحذير رقم **#${number}** لـ <@${target.id}>.`).catch(() => {});
            }

            const logCh = getLogChannel(message.guild);
            if (logCh) {
                await logCh.send({ embeds: [logEmbed('🗑️ تم إزالة تحذير', [
                    { name: '👤 العضو', value: `<@${target.id}>`, inline: true },
                    { name: '⚡ بواسطة', value: `<@${message.author.id}>`, inline: true },
                    { name: '#️⃣ الرقم المحذوف', value: `#${number}`, inline: true },
                ], Colors.Purple)] }).catch(() => {});
            }

            await message.reply(`🗑️ تم إزالة التحذير **#${number}** من <@${target.id}>.`).catch(() => {});
        } catch (err) {
            console.error('[Remove Warn Error]', err);
            await message.reply('❌ حصل خطأ في إزالة التحذير.').catch(() => {});
        }
        return;
    }

    if (cmd === 'تحذيرات') {
        const target = message.mentions.members.first();
        if (!target) return message.reply('❌ استخدم: `تحذيرات @العضو`').catch(() => {});

        try {
            const userWarns = await getWarnings(guildId, target.id);
            if (userWarns.length === 0) {
                return message.reply(`✅ <@${target.id}> ما عنده تحذيرات.`).catch(() => {});
            }

            const fields = userWarns.map(w => ({
                name: `تحذير #${w.number}`,
                value: `**السبب:** ${w.reason}\n**بواسطة:** <@${w.by}>\n**التاريخ:** <t:${Math.floor(w.date / 1000)}:R>`,
                inline: false
            }));

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ تحذيرات ${target.user.tag}`)
                .setDescription(`عدد التحذيرات: ${userWarns.length}`)
                .addFields(fields)
                .setColor(Colors.Orange)
                .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            await message.reply({ embeds: [embed] }).catch(() => {});
        } catch (err) {
            console.error('[Warns View Error]', err);
            await message.reply('❌ حصل خطأ في عرض التحذيرات.').catch(() => {});
        }
        return;
    }
});

/* ═══════════════════════════════════════
   VANITY PROTECTION — نهائي مُصلح
   ═══════════════════════════════════════ */

const vanityState = new Map();

async function checkVanity(guild) {
    const guildId = guild.id;
    if (!db.isVanityProtectionEnabled(guildId)) return;

    const savedURL = db.getVanityURL(guildId);
    if (!savedURL) return;

    let currentCode = null;
    try {
        const vanity = await guild.fetchVanityData();
        currentCode = vanity.code;
    } catch (err) {
        if (err.code === 10006 || err.status === 404 || err.message?.includes(' vanity')) {
            currentCode = null;
        } else {
            console.error(`[Vanity] fetch error in ${guild.name}:`, err.message);
            return;
        }
    }

    if (currentCode !== savedURL) {
        console.log(`[Vanity] ALERT ${guild.name}: saved=${savedURL}, current=${currentCode}`);
        await handleVanityChange(guild, savedURL, currentCode);
    }

    vanityState.set(guildId, { lastCode: currentCode, checking: false });
}

async function handleVanityChange(guild, targetURL, currentCode) {
    const guildId = guild.id;
    if (vanityState.get(guildId)?.checking) return;
    vanityState.set(guildId, { lastCode: currentCode, checking: true });

    const logCh = getLogChannel(guild);
    let executor = null;

    try {
        const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.GuildUpdate, limit: 5 });
        const entry = audit.entries.find(e =>
            e.createdTimestamp > Date.now() - 10000 &&
            e.executor && e.executor.id !== client.user.id
        );
        if (entry?.executor) executor = entry.executor;
    } catch (e) {
        console.error('[Audit Log]', e.message);
    }

    if (logCh) {
        await logCh.send({ embeds: [new EmbedBuilder()
            .setTitle('🚨 رابط السيرفر تغيّر!')
            .addFields(
                { name: '👤 المُنفّذ', value: executor ? `<@${executor.id}>` : 'غير معروف', inline: true },
                { name: '🔗 الحالي', value: currentCode ? `discord.gg/${currentCode}` : 'محذوف', inline: true },
                { name: '🔗 المطلوب', value: `discord.gg/${targetURL}`, inline: true }
            )
            .setColor(Colors.Orange)
            .setTimestamp()] }).catch(() => {});
    }

    let restored = false;
    for (let i = 1; i <= 5; i++) {
        try {
            console.log(`[Vanity] Attempt ${i}/5 → ${guild.name}`);
            await guild.edit({ vanityURLCode: targetURL });
            await new Promise(r => setTimeout(r, 2000));
            const verify = await guild.fetchVanityData().catch(() => null);
            if (verify && verify.code === targetURL) {
                restored = true;
                console.log(`[Vanity] ✅ Verified!`);
                break;
            }
        } catch (err) {
            console.error(`[Vanity] Attempt ${i} failed:`, err.message);
            if (i < 5) await new Promise(r => setTimeout(r, i * 2000));
        }
    }

    if (logCh) {
        await logCh.send({ embeds: [new EmbedBuilder()
            .setTitle(restored ? '✅ تم الإرجاع' : '❌ فشل الإرجاع')
            .setDescription(restored ? `discord.gg/${targetURL}` : 'تحقق من الصلاحيات والـ Boost')
            .setColor(restored ? Colors.Green : Colors.Red)
            .setTimestamp()] }).catch(() => {});
    }

    if (executor && executor.id !== OWNER_ID) {
        let banned = false;
        for (let i = 1; i <= 2; i++) {
            try {
                const member = await guild.members.fetch(executor.id).catch(() => null);
                if (!member) break;
                await member.ban({ reason: '🛡️ حماية الرابط' });
                banned = true;
                break;
            } catch (err) {
                console.error(`[Vanity] Ban failed:`, err.message);
                if (i < 2) await new Promise(r => setTimeout(r, 3000));
            }
        }

        if (logCh) {
            await logCh.send({ embeds: [new EmbedBuilder()
                .setTitle(banned ? '🔨 تم الحظر' : '⚠️ فشل الحظر')
                .setDescription(banned ? `<@${executor.id}> تم الحظر.` : 'رتبة البوت يجب أن تكون أعلى.')
                .setColor(banned ? Colors.Red : Colors.DarkOrange)
                .setTimestamp()] }).catch(() => {});
        }
    }

    vanityState.set(guildId, { lastCode: targetURL, checking: false });
}

client.once('ready', () => {
    console.log('═══════════════════════════════════════════');
    console.log(`  ⚡ Cypher is online: ${client.user.tag}`);
    console.log(`  🌐 Guilds: ${client.guilds.cache.size}`);
    console.log(`  👤 Owner: ${OWNER_ID || 'Not Set'}`);
    console.log('═══════════════════════════════════════════');
    client.user.setActivity('Cypher Protection', { type: 4 });

    client.guilds.cache.forEach(g => checkVanity(g));

    setInterval(() => {
        client.guilds.cache.forEach(g => checkVanity(g));
    }, 3000);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!db.isVanityProtectionEnabled(newGuild.id)) return;
    if (oldGuild.vanityURLCode === newGuild.vanityURLCode) return;
    console.log(`[Vanity Event] ${newGuild.name}: ${oldGuild.vanityURLCode} → ${newGuild.vanityURLCode}`);
    await checkVanity(newGuild);
});

client.on('error', (err) => console.error('[Discord Client Error]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err));

client.login(process.env.TOKEN).catch(err => {
    console.error('[Login Error]', err.message);
    process.exit(1);
});
