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
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Cypher Protection System', iconURL: client.user?.displayAvatarURL?.() || undefined });
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

const Warn = mongoose.model('Warn', warnSchema);

async function getWarnings(guildId, userId) {
    return await Warn.find({ guildId, userId }).sort({ number: 1 }).lean();
}

async function getNextWarningNumber(guildId, userId) {
    const lastWarn = await Warn.findOne({ guildId, userId }).sort({ number: -1 }).lean();
    return (lastWarn?.number || 0) + 1;
}

async function addWarning(guildId, userId, reason, byId) {
    const number = await getNextWarningNumber(guildId, userId);
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

/* ═══════════════════════════════════════════════════════════
   ═══ Vanity Protection (Detection + Ban + Alert Only) ═══
   ═══════════════════════════════════════════════════════════ */

const vanityState = new Map();

// ── اكتشاف فوري عبر Audit Log Entry Create ──
client.on('guildAuditLogEntryCreate', async (auditLogEntry, guild) => {
    if (auditLogEntry.action !== AuditLogEvent.GuildUpdate) return;

    const guildId = guild.id;
    if (!db.isVanityProtectionEnabled(guildId)) return;

    const savedURL = db.getVanityURL(guildId);
    if (!savedURL) return;

    const vanityChange = auditLogEntry.changes.find(c => c.key === 'vanity_url_code');
    if (!vanityChange) return;

    const newCode = vanityChange.new;
    const oldCode = vanityChange.old;
    if (newCode === savedURL) return;

    const executor = auditLogEntry.executor;
    console.log(`[Vanity Audit] ${guild.name}: ${oldCode} -> ${newCode} by ${executor?.tag || 'unknown'}`);

    await handleVanityChange(guild, savedURL, oldCode, newCode, executor, 'audit');
});

// ── الحدث التقليدي (احتياطي) ──
client.on('guildUpdate', async (oldGuild, newGuild) => {
    const guildId = newGuild.id;
    if (!db.isVanityProtectionEnabled(guildId)) return;

    const savedURL = db.getVanityURL(guildId);
    if (!savedURL) return;

    const oldVanity = oldGuild.vanityURLCode;
    const newVanity = newGuild.vanityURLCode;

    if (oldVanity === newVanity || newVanity === savedURL) return;

    console.log(`[Vanity Event] ${newGuild.name}: ${oldVanity} -> ${newVanity}`);
    await handleVanityChange(newGuild, savedURL, oldVanity, newVanity, null, 'event');
});

// ── فحص دوري (كل ثانية) ──
setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
        const guildId = guild.id;
        if (!db.isVanityProtectionEnabled(guildId)) continue;

        const savedURL = db.getVanityURL(guildId);
        if (!savedURL) continue;

        try {
            const vanity = await guild.fetchVanityData().catch(() => null);
            if (!vanity) continue;

            const currentCode = vanity.code;
            const lastCode = vanityState.get(guildId)?.lastCode;

            if (currentCode !== savedURL && currentCode !== lastCode) {
                console.log(`[Vanity Poll] ${guild.name}: detected ${currentCode} != ${savedURL}`);
                await handleVanityChange(guild, savedURL, lastCode || 'unknown', currentCode, null, 'poll');
            }

            vanityState.set(guildId, { lastCode: currentCode });
        } catch (err) {
            // تجاهل
        }
    }
}, 1000);

// ── المعالج الرئيسي (باند + إزالة رتب + تنبيه) ──
async function handleVanityChange(guild, savedURL, oldCode, newCode, executor, source) {
    const guildId = guild.id;
    if (vanityState.get(guildId)?.handling) return;
    vanityState.set(guildId, { ...vanityState.get(guildId), handling: true });

    console.log(`[Vanity] 🚨 ALERT in ${guild.name} | Source: ${source}`);

    const logCh = getLogChannel(guild);
    let rolesRemoved = false;
    let banned = false;

    // ── 1. إزالة جميع الرتب من المنفذ (Quarantine) ──
    if (executor && executor.id !== client.user.id) {
        try {
            const member = await guild.members.fetch(executor.id).catch(() => null);
            if (member) {
                const roles = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id && r.position < guild.members.me.roles.highest.position);
                if (roles.size > 0) {
                    await member.roles.remove(roles, '🛡️ محاولة تغيير Vanity URL');
                    rolesRemoved = true;
                    console.log(`[Vanity] 🗑️ Removed ${roles.size} roles from ${executor.tag}`);
                }
            }
        } catch (err) {
            console.error(`[Vanity] Remove roles failed:`, err.message);
        }
    }

    // ── 2. باند فوري ──
    if (executor && executor.id !== client.user.id) {
        try {
            const member = await guild.members.fetch(executor.id).catch(() => null);
            if (member) {
                await member.ban({
                    reason: '🛡️ Cypher Protection - تغيير Vanity URL',
                    deleteMessageSeconds: 0
                });
                banned = true;
                console.log(`[Vanity] 🔨 BANNED ${executor.tag}`);
            }
        } catch (err) {
            console.error(`[Vanity] Ban failed:`, err.message);
        }
    }

    // ── 3. تنبيه الأونر في الخاص ──
    if (OWNER_ID) {
        try {
            const owner = await client.users.fetch(OWNER_ID);
            const alertEmbed = new EmbedBuilder()
                .setTitle('🚨 تنبيه فوري: تغيير Vanity URL!')
                .setDescription(`السيرفر: **${guild.name}**\nالاختصار تغيّر من \`discord.gg/${oldCode}\` إلى \`discord.gg/${newCode}\``)
                .addFields(
                    { name: '👤 المنفذ', value: executor ? `<@${executor.id}> (${executor.tag})` : 'غير معروف', inline: true },
                    { name: '🔨 الحظر', value: banned ? '✅ تم الحظر' : '❌ فشل', inline: true },
                    { name: '🗑️ الرتب', value: rolesRemoved ? '✅ تم إزالتها' : '❌ فشل', inline: true },
                    { name: '⚡ المصدر', value: source === 'audit' ? 'Audit Log (فوري)' : source === 'event' ? 'Guild Update' : 'فحص دوري', inline: false }
                )
                .setColor(Colors.Red)
                .setTimestamp();

            await owner.send({ embeds: [alertEmbed] });
            console.log(`[Vanity] 📩 Alert sent to owner`);
        } catch (err) {
            console.error(`[Vanity] Owner DM failed:`, err.message);
        }
    }

    // ── 4. إرسال اللوق ──
    if (logCh) {
        const embed = new EmbedBuilder()
            .setTitle('🚨 Vanity URL تغيّر!')
            .setDescription(`**الاختصار القديم:** discord.gg/${oldCode || 'غير معروف'}\n**الاختصار الجديد:** discord.gg/${newCode}`)
            .addFields(
                { name: '👤 المنفذ', value: executor ? `<@${executor.id}> (${executor.tag})` : 'غير معروف', inline: true },
                { name: '🔗 الكود المطلوب', value: `discord.gg/${savedURL}`, inline: true },
                { name: '⚡ المصدر', value: source === 'audit' ? 'Audit Log (فوري)' : source === 'event' ? 'Guild Update' : 'فحص دوري', inline: true },
                { name: '🔨 الحظر', value: banned ? `✅ تم حظر <@${executor.id}>` : (executor ? '❌ فشل' : 'لا يوجد'), inline: true },
                { name: '🗑️ إزالة الرتب', value: rolesRemoved ? '✅ تمت' : '❌ فشل', inline: true }
            )
            .setColor(Colors.Red)
            .setTimestamp();

        logCh.send({ embeds: [embed] }).catch(() => {});
    }

    vanityState.set(guildId, { ...vanityState.get(guildId), handling: false });
}

/* ─── Ready ─── */
client.once('ready', () => {
    console.log('═══════════════════════════════════════════');
    console.log(`  ⚡ Cypher is online: ${client.user.tag}`);
    console.log(`  🌐 Guilds: ${client.guilds.cache.size}`);
    console.log(`  👤 Owner: ${OWNER_ID || 'Not Set'}`);
    console.log('═══════════════════════════════════════════');
    client.user.setActivity('Cypher Protection', { type: 4 });
});

client.on('error', (err) => console.error('[Discord Client Error]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err));

client.login(process.env.TOKEN).catch(err => {
    console.error('[Login Error]', err.message);
    process.exit(1);
});
