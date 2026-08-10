require('dotenv').config();
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
const { joinVoiceChannel } = require('@discordjs/voice');
const db = require('./database');

// ═══════════════════════════════════════════════════
// ⚡ Cypher — Voice & Vanity Protection Bot
// ═══════════════════════════════════════════════════

const OWNER_ID = process.env.OWNER_ID;

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
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites,
    ]
});

let botReadyAt = 0;

// ═══════════════════════════════════════════════════
// 🔧 Helpers
// ═══════════════════════════════════════════════════

/**
 * جلب روم اللوق المُسجّل لسيرفر معين
 */
function getLogChannel(guild) {
    const id = db.getLogChannel(guild.id);
    return id ? guild.channels.cache.get(id) : null;
}

/**
 * بناء Embed موحّد للوقات
 */
function logEmbed(title, fields, color = Colors.Blue) {
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Cypher Protection System', iconURL: client.user?.displayAvatarURL?.() || undefined });
}

/**
 * التحقق إذا العضو فوق البوت في الترتيب
 */
function isAboveBot(member, guild) {
    const botMember = guild.members.me;
    if (!botMember) return false;
    return member.roles.highest.position > botMember.roles.highest.position;
}

/**
 * التحقق من صلاحية الإدارة
 */
function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/**
 * التحقق من صلاحية التحكم في البوت (Admin أو فوق البوت أو Owner)
 */
function canManageBot(member, guild) {
    if (member.id === OWNER_ID) return true;
    if (isAdmin(member)) return true;
    if (isAboveBot(member, guild)) return true;
    return false;
}

// ═══════════════════════════════════════════════════
// 📋 Slash Commands Definition
// ═══════════════════════════════════════════════════

const slashCommands = [
    {
        name: 'setlog',
        description: 'تحديد روم لوق الفويسات',
        type: 1,
        default_member_permissions: '8', // Administrator
        options: [
            {
                name: 'channel',
                description: 'اختر روم اللوق',
                type: 7, // CHANNEL
                channel_types: [0], // Text only
                required: true
            }
        ]
    },
    {
        name: 'afk-voice',
        description: 'يدخل البوت روم الفويس المحدد',
        type: 1,
        default_member_permissions: '8',
        options: [
            {
                name: 'channel',
                description: 'اختر روم الفويس',
                type: 7,
                channel_types: [2], // Voice only
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
                type: 3, // STRING
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
                type: 5, // BOOLEAN
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

/* ─── Guild Create ─── */
client.on('guildCreate', async (guild) => {
    try {
        await guild.commands.set(slashCommands);
        console.log(`[+] Slash commands registered in: ${guild.name} (${guild.id})`);
    } catch (err) {
        console.error(`[-] Failed to register slash commands in ${guild.name}:`, err.message);
    }
});

/* ─── Interaction Handler ─── */
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

    // ── vanity-protect: يحتاج فوق البوت أو Owner ──
    if (commandName === 'vanity-protect') {
        if (!canManageBot(member, interaction.guild)) {
            return interaction.reply({
                content: '❌ لازم تكون فوق البوت أو تملك صلاحية الإدارة عشان تستخدم هذا الأمر.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }

        const on = interaction.options.getBoolean('enabled');
        db.toggleVanityProtection(guildId, on);
        return interaction.reply({
            content: on ? '✅ حماية الرابط مفعلة.' : '⚠️ حماية الرابط معطلة.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    // ── بقية الأوامر: تحتاج Admin ──
    if (!isAdmin(member)) {
        return interaction.reply({
            content: '❌ هذا الأمر للإدارة فقط.',
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

    if (commandName === 'afk-voice') {
        const ch = interaction.options.getChannel('channel');
        if (!ch) {
            return interaction.reply({
                content: '❌ الروم غير موجود.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }

        try {
            joinVoiceChannel({
                channelId: ch.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });

            return interaction.reply({
                content: `🔊 دخلت ${ch} وأنا AFK هناك الآن.`,
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        } catch (err) {
            console.error('[AFK Voice Error]', err);
            return interaction.reply({
                content: '❌ ما قدرت أدخل الروم، تأكد من صلاحياتي.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
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

    if (commandName === 'settings') {
        const logChId = db.getLogChannel(guildId);
        const logCh = logChId ? `<#${logChId}>` : 'غير محدد';
        const vanity = db.isVanityProtectionEnabled(guildId) ? '✅ مفعلة' : '⚠️ معطلة';
        const vanityURL = db.getVanityURL(guildId) || 'غير محدد';
        const voiceConnection = interaction.guild.members.me?.voice?.channel;
        const afkStatus = voiceConnection ? `🔊 في ${voiceConnection}` : '🔇 برا الفويس';

        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعدادات البوت')
            .addFields(
                { name: '📝 روم اللوق', value: logCh, inline: true },
                { name: '🔗 رابط السيرفر', value: `discord.gg/${vanityURL}`, inline: true },
                { name: '🛡️ حماية الرابط', value: vanity, inline: true },
                { name: '🎤 الحالة', value: afkStatus, inline: true }
            )
            .setColor(Colors.Gold)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

// ═══════════════════════════════════════════════════
// 🎙️ Voice State Logging (اللوقات)
// ═══════════════════════════════════════════════════

client.on('voiceStateUpdate', async (oldState, newState) => {
    // نتجاهل الأحداث في أول 5 ثواني من تشغيل البوت
    if (Date.now() - botReadyAt < 5000) return;

    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const logCh = getLogChannel(guild);
    if (!logCh) return;

    const member = newState.member || oldState.member;
    if (!member) return;

    const oldCh = oldState.channel;
    const newCh = newState.channel;

    // ── 1. Server Mute ──
    if (oldState.serverMute !== newState.serverMute) {
        const action = newState.serverMute ? '🔇 كتم الصوت' : '🔊 فك الكتم';
        const color = newState.serverMute ? Colors.Red : Colors.Green;

        setTimeout(async () => {
            try {
                const audit = await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 10
                });

                const entry = audit.entries.find(e =>
                    e.target?.id === member.id &&
                    e.createdTimestamp > Date.now() - 15000 &&
                    e.changes?.some(c => c.key === 'mute')
                );

                const by = entry?.executor ? `<@${entry.executor.id}>` : 'غير معروف';

                const embed = logEmbed(action, [
                    { name: '👤 العضو', value: `<@${member.id}>`, inline: true },
                    { name: '📢 القناة', value: (newCh || oldCh)?.name || 'غير معروف', inline: true },
                    { name: '⚡ بواسطة', value: by, inline: true },
                ], color);

                await logCh.send({ embeds: [embed] });
            } catch (e) {
                console.error('[Mute Audit Error]', e.message);
            }
        }, 1200);
    }

    // ── 2. Server Deaf ──
    if (oldState.serverDeaf !== newState.serverDeaf) {
        const action = newState.serverDeaf ? '🔇 دفن السماعة' : '🔊 فك الدفن';
        const color = newState.serverDeaf ? Colors.Red : Colors.Green;

        setTimeout(async () => {
            try {
                const audit = await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 10
                });

                const entry = audit.entries.find(e =>
                    e.target?.id === member.id &&
                    e.createdTimestamp > Date.now() - 15000 &&
                    e.changes?.some(c => c.key === 'deaf')
                );

                const by = entry?.executor ? `<@${entry.executor.id}>` : 'غير معروف';

                const embed = logEmbed(action, [
                    { name: '👤 العضو', value: `<@${member.id}>`, inline: true },
                    { name: '📢 القناة', value: (newCh || oldCh)?.name || 'غير معروف', inline: true },
                    { name: '⚡ بواسطة', value: by, inline: true },
                ], color);

                await logCh.send({ embeds: [embed] });
            } catch (e) {
                console.error('[Deaf Audit Error]', e.message);
            }
        }, 1200);
    }

    // ── 3. Move (نقل بين الرومات) ──
    if (oldCh && newCh && oldCh.id !== newCh.id) {
        setTimeout(async () => {
            try {
                const audit = await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberMove,
                    limit: 10
                });

                const entry = audit.entries.find(e =>
                    e.target?.id === member.id &&
                    e.createdTimestamp > Date.now() - 10000
                );

                if (entry?.executor) {
                    const embed = logEmbed('🔄 نقل بين الرومات', [
                        { name: '👤 العضو', value: `<@${member.id}>`, inline: true },
                        { name: '📤 من', value: oldCh.name, inline: true },
                        { name: '📥 إلى', value: newCh.name, inline: true },
                        { name: '⚡ النقل بواسطة', value: `<@${entry.executor.id}>`, inline: true },
                    ], Colors.Yellow);

                    await logCh.send({ embeds: [embed] });
                }
            } catch (e) {
                console.error('[Move Audit Error]', e.message);
            }
        }, 1500);
    }

    // ── 4. Disconnect (طرد من الفويس) ──
    // هذا أهم جزء — تم إصلاحه بشكل كامل
    if (oldCh && !newCh) {
        // ننتظر 3.5 ثانية عشان الـ Audit Log يتسجل بشكل صحيح
        setTimeout(async () => {
            try {
                let entry = null;

                // الخطوة 1: نبحث في MemberDisconnect
                try {
                    const disconnectAudit = await guild.fetchAuditLogs({
                        type: AuditLogEvent.MemberDisconnect,
                        limit: 20
                    });

                    entry = disconnectAudit.entries.find(e =>
                        e.target?.id === member.id &&
                        e.createdTimestamp > Date.now() - 25000
                    );
                } catch (err) {
                    console.error('[Disconnect Audit Fetch Error]', err.message);
                }

                // الخطوة 2: fallback — نبحث في MemberMove (بعض السيرفرات تسجله كنقل)
                if (!entry) {
                    try {
                        const moveAudit = await guild.fetchAuditLogs({
                            type: AuditLogEvent.MemberMove,
                            limit: 20
                        });

                        entry = moveAudit.entries.find(e =>
                            e.target?.id === member.id &&
                            e.createdTimestamp > Date.now() - 25000
                        );
                    } catch (err) {
                        console.error('[Move Audit Fallback Error]', err.message);
                    }
                }

                // الخطوة 3: لو لقينا executor يعني الشخص طُرد
                if (entry?.executor && entry.executor.id !== client.user.id) {
                    const embed = logEmbed('🚫 طرد من الفويس', [
                        { name: '👤 العضو', value: `<@${member.id}>`, inline: true },
                        { name: '📢 القناة', value: oldCh.name, inline: true },
                        { name: '⚡ الطارد', value: `<@${entry.executor.id}>`, inline: true },
                        { name: '🕐 الوقت', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    ], Colors.DarkRed);

                    await logCh.send({ embeds: [embed] });
                }
                // لو ما لقينا executor → العضو غادر بإرادته (ما نسوي شي)
            } catch (e) {
                console.error('[Disconnect Handler Error]', e.message);
            }
        }, 3500);
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

                // ── لوق التنبيه ──
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

                // ── إرجاع الرابط ──
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

                // ── باند الشخص ──
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
    botReadyAt = Date.now();
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

// ═══════════════════════════════════════════════════
// 🔑 Login
// ═══════════════════════════════════════════════════

client.login(process.env.TOKEN).catch(err => {
    console.error('[Login Error]', err.message);
    process.exit(1);
});
