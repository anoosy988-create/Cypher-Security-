require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
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

// ═══════════════════════════════════════════════════
// ⚡ Cypher — Protection Bot (Vanity + Lock + Warns)
// ═══════════════════════════════════════════════════

const OWNER_ID = process.env.OWNER_ID;
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');

/* ─── HTTP Keep-Alive Server ─── */
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

// ═══════════════════════════════════════════════════
// 🔧 Helpers
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// ⚠️ Warning System (Persistent JSON)
// ═══════════════════════════════════════════════════

let warnings = new Map();
let guildCounters = new Map();

function loadWarnings() {
    try {
        if (!fs.existsSync(WARNINGS_FILE)) {
            fs.writeFileSync(WARNINGS_FILE, JSON.stringify({ warnings: {}, counters: {} }, null, 2));
            console.log('[✓] ملف warnings.json ما كان موجود — سويته الآن.');
            return;
        }

        const raw = fs.readFileSync(WARNINGS_FILE, 'utf8');
        if (!raw.trim()) {
            console.log('[!] ملف warnings.json فارغ.');
            return;
        }

        const data = JSON.parse(raw);

        if (data.warnings) {
            for (const [guildId, guildData] of Object.entries(data.warnings)) {
                const userMap = new Map();
                for (const [userId, userWarns] of Object.entries(guildData)) {
                    userMap.set(userId, userWarns);
                }
                warnings.set(guildId, userMap);
            }
        }

        if (data.counters) {
            for (const [guildId, counter] of Object.entries(data.counters)) {
                guildCounters.set(guildId, counter);
            }
        }

        let totalWarns = 0;
        for (const guildMap of warnings.values()) {
            for (const userWarns of guildMap.values()) {
                totalWarns += userWarns.length;
            }
        }

        console.log(`[✓] تم تحميل التحذيرات: ${totalWarns} تحذير، ${guildCounters.size} سيرفر.`);
    } catch (err) {
        console.error('[✗] خطأ في تحميل التحذيرات:', err.message);
        warnings = new Map();
        guildCounters = new Map();
    }
}

function saveWarnings() {
    try {
        const data = { warnings: {}, counters: {} };

        for (const [guildId, guildMap] of warnings) {
            data.warnings[guildId] = {};
            for (const [userId, userWarns] of guildMap) {
                data.warnings[guildId][userId] = userWarns;
            }
        }

        for (const [guildId, counter] of guildCounters) {
            data.counters[guildId] = counter;
        }

        fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2));
        console.log('[✓] تم حفظ التحذيرات في الملف.');
    } catch (err) {
        console.error('[✗] خطأ في حفظ التحذيرات:', err.message);
    }
}

function getWarnings(guildId, userId) {
    if (!warnings.has(guildId)) warnings.set(guildId, new Map());
    const guildWarns = warnings.get(guildId);
    if (!guildWarns.has(userId)) guildWarns.set(userId, []);
    return guildWarns.get(userId);
}

function getNextWarningNumber(guildId) {
    if (!guildCounters.has(guildId)) guildCounters.set(guildId, 1);
    const num = guildCounters.get(guildId);
    guildCounters.set(guildId, num + 1);
    return num;
}

function addWarning(guildId, userId, reason, byId) {
    const userWarns = getWarnings(guildId, userId);
    const number = getNextWarningNumber(guildId);
    userWarns.push({
        number,
        reason,
        by: byId,
        date: Date.now()
    });
    saveWarnings();
    return number;
}

// حمل التحذيرات فوراً
loadWarnings();

// ═══════════════════════════════════════════════════
// 📋 Slash Commands
// ═══════════════════════════════════════════════════

const slashCommands = [
    {
        name: 'setlog',
        description: 'تحديد روم لوق الحماية',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'channel',
                description: 'اختر روم اللوق',
                type: 7,
                channel_types: [0],
                required: true
            }
        ]
    },
    {
        name: 'setvanity',
        description: 'تحديد رابط السيرفر المخصص للحماية',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'url',
                description: 'اكتب الرابط بدون discord.gg/ مثلاً: ab10',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'vanity-protect',
        description: 'تفعيل/تعطيل حماية رابط السيرفر',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'enabled',
                description: 'تفعيل أو تعطيل',
                type: 5,
                required: true
            }
        ]
    },
    {
        name: 'settings',
        description: 'عرض إعدادات البوت الحالية',
        type: 1,
        default_member_permissions: '8'
    }
];

// ═══════════════════════════════════════════════════
// 🚀 Events
// ═══════════════════════════════════════════════════

client.on('guildCreate', async (guild) => {
    try {
        await guild.commands.set(slashCommands);
        console.log(`[+] Slash commands registered in: ${guild.name} (${guild.id})`);
    } catch (err) {
        console.error(`[-] Failed to register slash commands in ${guild.name}:`, err.message);
    }
});

/* ─── Slash Commands Handler ─── */
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
        return interaction.reply({
            content: 'هذا الأمر يعمل في السيرفرات فقط.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    const { commandName } = interaction;
    const guildId = interaction.guild.id;
    const member = interaction.member;

    if (!isAdmin(member)) {
        return interaction.reply({
            content: '❌ هذا الأمر للإدارة فقط (Administrator).',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    if (commandName === 'setlog') {
        const ch = interaction.options.getChannel('channel');
        if (!ch) {
            return interaction.reply({
                content: '❌ الروم غير موجود.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
        db.setLogChannel(guildId, ch.id);
        return interaction.reply({
            content: `✅ تم تحديد ${ch} روم اللوق.`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    if (commandName === 'setvanity') {
        const url = interaction.options.getString('url')?.trim();
        if (!url) {
            return interaction.reply({
                content: '❌ الرابط فارغ.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
        db.setVanityURL(guildId, url);
        return interaction.reply({
            content: `✅ تم تحديد رابط السيرفر: discord.gg/${url}`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    if (commandName === 'vanity-protect') {
        const on = interaction.options.getBoolean('enabled');
        db.toggleVanityProtection(guildId, on);
        return interaction.reply({
            content: on ? '✅ حماية الرابط مفعلة.' : '⚠️ حماية الرابط معطلة.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
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
                { name: '🔗 رابط السيرفر', value: `discord.gg/${vanityURL}`, inline: true },
                { name: '🛡️ حماية الرابط', value: vanity, inline: true }
            )
            .setColor(Colors.Gold)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

/* ─── Prefix Commands Handler ─── */
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    if (!content) return;

    const args = content.split(/\s+/);
    const cmd = args[0];

    if (!isAdmin(message.member)) return;

    const guildId = message.guild.id;

    // ── ق: قفل الشات ──
    if (cmd === 'ق') {
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: false
            });

            const logCh = getLogChannel(message.guild);
            if (logCh) {
                const embed = logEmbed('🔒 تم قفل الشات', [
                    { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
                    { name: '📢 القناة', value: `<#${message.channel.id}>`, inline: true },
                ], Colors.Red);
                await logCh.send({ embeds: [embed] }).catch(() => {});
            }

            await message.reply('🔒 تم قفل الشات بنجاح.').catch(() => {});
        } catch (err) {
            console.error('[Lock Error]', err);
            await message.reply('❌ ما قدرت أقفل الشات، تأكد من صلاحياتي.').catch(() => {});
        }
        return;
    }

    // ── ف: فتح الشات ──
    if (cmd === 'ف') {
        try {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                SendMessages: true
            });

            const logCh = getLogChannel(message.guild);
            if (logCh) {
                const embed = logEmbed('🔓 تم فتح الشات', [
                    { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
                    { name: '📢 القناة', value: `<#${message.channel.id}>`, inline: true },
                ], Colors.Green);
                await logCh.send({ embeds: [embed] }).catch(() => {});
            }

            await message.reply('🔓 تم فتح الشات بنجاح.').catch(() => {});
        } catch (err) {
            console.error('[Unlock Error]', err);
            await message.reply('❌ ما قدرت أفتح الشات، تأكد من صلاحياتي.').catch(() => {});
        }
        return;
    }

    // ── تح: إعطاء تحذير ──
    if (cmd === 'تح') {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply('❌ استخدم: `تح @العضو السبب`').catch(() => {});
        }

        const reason = args.slice(2).join(' ');
        if (!reason) {
            return message.reply('❌ اكتب سبب التحذير. استخدم: `تح @العضو السبب`').catch(() => {});
        }

        const warnNumber = addWarning(guildId, target.id, reason, message.author.id);
        console.log(`[+] تحذير جديد: #${warnNumber} لـ ${target.user.tag} في سيرفر ${guildId}`);

        const logCh = getLogChannel(message.guild);
        if (logCh) {
            const embed = logEmbed('⚠️ تحذير جديد', [
                { name: '👤 العضو', value: `<@${target.id}>`, inline: true },
                { name: '⚡ بواسطة', value: `<@${message.author.id}>`, inline: true },
                { name: '📋 السبب', value: reason, inline: false },
                { name: '#️⃣ رقم التحذير', value: `#${warnNumber}`, inline: true },
            ], Colors.Orange);
            await logCh.send({ embeds: [embed] }).catch(() => {});
        }

        await message.reply(`⚠️ تم إعطاء التحذير #${warnNumber} لـ <@${target.id}>\n**السبب:** ${reason}`).catch(() => {});
        return;
    }

    // ── تحذيرات: عرض تحذيرات العضو ──
    if (cmd === 'تحذيرات') {
        const target = message.mentions.members.first();
        if (!target) {
            return message.reply('❌ استخدم: `تحذيرات @العضو`').catch(() => {});
        }

        const userWarns = getWarnings(guildId, target.id);
        console.log(`[i] عرض تحذيرات ${target.user.tag}: ${userWarns.length} تحذير.`);

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
        return;
    }
});

// ═══════════════════════════════════════════════════
// 🛡️ Vanity URL Protection
// ═══════════════════════════════════════════════════

client.on('guildUpdate', async (oldGuild, newGuild) => {
    const guildId = newGuild.id;

    if (!db.isVanityProtectionEnabled(guildId)) return;

    const vanityURL = db.getVanityURL(guildId);
    if (!vanityURL) return;

    const oldVanity = oldGuild.vanityURLCode;
    const newVanity = newGuild.vanityURLCode;

    if (oldVanity && oldVanity !== newVanity) {
        const logCh = getLogChannel(newGuild);

        try {
            const audit = await newGuild.fetchAuditLogs({
                type: AuditLogEvent.GuildUpdate,
                limit: 5
            });

            const entry = audit.entries.find(e =>
                e.createdTimestamp > Date.now() - 5000 &&
                e.executor &&
                e.executor.id !== client.user.id
            );

            if (entry?.executor) {
                const executor = entry.executor;

                if (logCh) {
                    const detectEmbed = new EmbedBuilder()
                        .setTitle('🚨 تنبيه: رابط السيرفر تغيّر')
                        .addFields(
                            { name: '👤 الشخص', value: `<@${executor.id}>`, inline: true },
                            { name: '🔗 الرابط القديم', value: `discord.gg/${oldVanity}`, inline: true },
                            { name: '🔗 الرابط الجديد', value: newVanity ? `discord.gg/${newVanity}` : 'تم الحذف', inline: true }
                        )
                        .setColor(Colors.Orange)
                        .setTimestamp();
                    await logCh.send({ embeds: [detectEmbed] }).catch(() => {});
                }

                let restored = false;
                try {
                    await newGuild.edit({ vanityURLCode: vanityURL });
                    restored = true;
                } catch (e) {
                    console.error('[Vanity Restore Error]', e.message);
                }

                if (logCh) {
                    const restoreEmbed = new EmbedBuilder()
                        .setTitle(restored ? '✅ تم إرجاع الرابط' : '⚠️ فشل إرجاع الرابط')
                        .setDescription(
                            restored
                                ? `تم إرجاع الرابط إلى: discord.gg/${vanityURL}`
                                : 'لم يتمكن البوت من إرجاع الرابط، تحقق من أن البوت يملك صلاحية Manage Server.'
                        )
                        .setColor(restored ? Colors.Green : Colors.DarkOrange)
                        .setTimestamp();
                    await logCh.send({ embeds: [restoreEmbed] }).catch(() => {});
                }

                let banned = false;
                try {
                    const member = await newGuild.members.fetch(executor.id).catch(() => null);
                    if (member) {
                        await member.ban({
                            reason: '🛡️ حماية الرابط: محاولة تغيير رابط السيرفر المخصص'
                        });
                        banned = true;
                    }
                } catch (e) {
                    console.error('[Vanity Ban Error]', e.message);
                }

                if (logCh) {
                    const banEmbed = new EmbedBuilder()
                        .setTitle(banned ? '🔨 تم الباند' : '⚠️ فشل الباند')
                        .setDescription(
                            banned
                                ? `<@${executor.id}> تم حظره من السيرفر.`
                                : `لم يتمكن البوت من حظر <@${executor.id}>، تحقق من ترتيب الرتب.`
                        )
                        .setColor(banned ? Colors.Red : Colors.DarkOrange)
                        .setTimestamp();
                    await logCh.send({ embeds: [banEmbed] }).catch(() => {});
                }
            }
        } catch (err) {
            console.error('[Vanity Protection Error]', err);
        }
    }
});

// ═══════════════════════════════════════════════════
// 🤖 Ready & Errors
// ═══════════════════════════════════════════════════

client.once('ready', () => {
    console.log('═══════════════════════════════════════════');
    console.log(`  ⚡ Cypher is online: ${client.user.tag}`);
    console.log(`  🌐 Guilds: ${client.guilds.cache.size}`);
    console.log(`  👤 Owner: ${OWNER_ID || 'Not Set'}`);
    console.log('═══════════════════════════════════════════');
    client.user.setActivity('Cypher Protection', { type: 4 });
});

client.on('error', (err) => {
    console.error('[Discord Client Error]', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]', err);
});

client.login(process.env.TOKEN).catch(err => {
    console.error('[Login Error]', err.message);
    process.exit(1);
});
