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

    /* ═══════════════════════════════════════
       تفعيل الحماية يحفظ الرابط الحالي تلقائيًا
       كـ baseline لو ما فيه رابط محفوظ أصلاً —
       بدون هذا، الحماية تفعّل بس ما تسوي شي أبدًا
       لأن checkVanity/guildUpdate يطلعون فورًا
       إذا savedURL فاضي.
       ═══════════════════════════════════════ */
    if (commandName === 'vanity-protect') {
        const on = interaction.options.getBoolean('enabled');

        if (on) {
            const existingSaved = db.getVanityURL(guildId);
            if (!existingSaved) {
                try {
                    const vanity = await interaction.guild.fetchVanityData();
                    if (!vanity.code) {
                        return interaction.reply({
                            content: '❌ السيرفر ما عنده رابط مخصص (Custom Invite Link) حاليًا. حدد رابط أول بـ `/setvanity` أو فعّله من إعدادات السيرفر.',
                            flags: MessageFlags.Ephemeral
                        }).catch(() => {});
                    }
                    db.setVanityURL(guildId, vanity.code);
                } catch (err) {
                    return interaction.reply({
                        content: `❌ ما قدرت أوصل لبيانات الرابط: ${err.message}\nتأكد إن صلاحية Manage Server موجودة للبوت.`,
                        flags: MessageFlags.Ephemeral
                    }).catch(() => {});
                }
            }
        }

        db.toggleVanityProtection(guildId, on);
        const savedNow = db.getVanityURL(guildId);
        return interaction.reply({
            content: on
                ? `✅ حماية الرابط مفعلة. الرابط المحمي: discord.gg/${savedNow}`
                : '⚠️ معطلة.',
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
   VANITY PROTECTION — حظر فوري + إرجاع موثوق
   ═══════════════════════════════════════ */

const vanityState = new Map();

// ── الحدث الرئيسي (الاكتشاف الفوري) ──
client.on('guildUpdate', async (oldGuild, newGuild) => {
    const guildId = newGuild.id;

    const enabled = db.isVanityProtectionEnabled(guildId);
    const savedURL = db.getVanityURL(guildId);

    if (!enabled) return;
    if (!savedURL) {
        console.warn(`[Vanity] Protection ON but no saved URL for ${newGuild.name} — run /vanity-protect true again`);
        return;
    }

    const oldVanity = oldGuild.vanityURLCode;
    const newVanity = newGuild.vanityURLCode;

    if (oldVanity === newVanity) return;   // ما تغيّر شي فعلي
    if (newVanity === savedURL) return;    // رجع هو نفسه للمطلوب

    console.log(`[Vanity Event] ${newGuild.name}: ${oldVanity} → ${newVanity}`);
    handleVanityChange(newGuild, savedURL, newVanity); // بدون await — ما نعطّل الـ event loop
});

// ── Polling احتياطي كل ثانيتين (يغطي أي حالة ما وصلها حدث guildUpdate) ──
client.once('ready', () => {
    console.log('[Vanity] Polling backup started');

    setInterval(() => {
        client.guilds.cache.forEach(async (guild) => {
            const enabled = db.isVanityProtectionEnabled(guild.id);
            const savedURL = db.getVanityURL(guild.id);
            if (!enabled || !savedURL) return;
            if (vanityState.get(guild.id)?.checking) return; // فيه معالجة شغالة أصلاً

            try {
                const vanity = await guild.fetchVanityData();
                if (vanity.code !== savedURL) {
                    console.log(`[Vanity Polling] ALERT ${guild.name}: ${vanity.code} !== ${savedURL}`);
                    handleVanityChange(guild, savedURL, vanity.code);
                }
            } catch (err) {
                if (err.code === 10006 || err.status === 404) {
                    console.log(`[Vanity Polling] ${guild.name}: Vanity deleted!`);
                    handleVanityChange(guild, savedURL, null);
                }
            }
        });
    }, 2000);
});

/* ═══════════════════════════════════════
   المعالج الرئيسي — الحظر والإرجاع يصيرون
   بالتوازي (Promise.all)، مو الواحد بعد الثاني.
   هذا يخلي الحظر فوري بغض النظر عن كم
   محاولة يحتاجها إرجاع الرابط.
   ═══════════════════════════════════════ */
async function handleVanityChange(guild, targetURL, currentCode) {
    const guildId = guild.id;

    if (vanityState.get(guildId)?.checking) {
        console.log(`[Vanity] Skipping ${guild.name} (already handling)`);
        return;
    }
    vanityState.set(guildId, { checking: true });

    console.log(`[Vanity] Handling change for ${guild.name}`);

    const logCh = getLogChannel(guild);
    let executor = null;

    // ── جلب المُنفّذ من الأودت لوق (نحتاجه فورًا عشان الحظر) ──
    // نفلتر تحديدًا على الحدث اللي غيّر حقل vanity_url_code فعليًا،
    // مو أي GuildUpdate صار بنفس الفترة (وإلا ممكن يلتقط شخص ثاني غلط).
    try {
        const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.GuildUpdate, limit: 10 });
        const entry = audit.entries.find(e =>
            e.executor &&
            e.executor.id !== client.user.id &&
            e.changes?.some(c => c.key === 'vanity_url_code')
        );
        if (entry?.executor) executor = entry.executor;
    } catch (e) {
        console.error('[Audit Log]', e.message);
    }

    // ── لوق التنبيه الفوري ──
    if (logCh) {
        logCh.send({ embeds: [new EmbedBuilder()
            .setTitle('🚨 رابط السيرفر تغيّر!')
            .addFields(
                { name: '👤 المُنفّذ', value: executor ? `<@${executor.id}> (${executor.tag})` : 'غير معروف', inline: true },
                { name: '🔗 الرابط الحالي', value: currentCode ? `discord.gg/${currentCode}` : 'تم الحذف', inline: true },
                { name: '🔗 الرابط المطلوب', value: `discord.gg/${targetURL}`, inline: true }
            )
            .setColor(Colors.Orange)
            .setTimestamp()] }).catch(() => {});
    }

    /* ── المسار ١: الحظر — فوري، ما ينتظر نتيجة الإرجاع ── */
    const banPromise = (async () => {
        if (!executor) return { skipped: 'unknown' };
        if (executor.id === OWNER_ID) return { skipped: 'owner' };
        try {
            const member = await guild.members.fetch(executor.id).catch(() => null);
            if (!member) return { ok: false, reason: 'العضو غير موجود بالسيرفر (طلع بنفسه؟).' };
            await member.ban({ reason: '🛡️ حماية الرابط - تغيير الاختصار' });
            console.log(`[Vanity] 🔨 Banned ${executor.tag}`);
            return { ok: true };
        } catch (err) {
            console.error('[Vanity] Ban failed:', err.message);
            let reason = err.message;
            if (err.code === 50013) reason = 'صلاحيات ناقصة أو رتبة البوت أوطى من العضو.';
            return { ok: false, reason };
        }
    })();

    /* ── المسار ٢: إرجاع الرابط — تشخيص كامل، بدون استعجال ── */
    const restorePromise = (async () => {
        const me = guild.members.me;
        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return { ok: false, reason: 'البوت ما عنده صلاحية "Manage Server" فعليًا رغم الرتبة.' };
        }

        // تحقق: هل السيرفر أصلاً يملك ميزة الرابط المخصص عند ديسكورد؟
        const hasVanityFeature = guild.features.includes('VANITY_URL');
        console.log(`[Vanity] Guild features: ${guild.features.join(', ') || '(none)'}`);
        console.log(`[Vanity] Has VANITY_URL feature: ${hasVanityFeature}`);
        if (!hasVanityFeature) {
            return {
                ok: false,
                reason: `السيرفر ما عنده ميزة VANITY_URL مفعّلة عند ديسكورد (مطلوبة لتعديل الرابط عبر الـ API)، حتى لو تقدر تغيّره يدويًا من التطبيق.\nميزات السيرفر الحالية: ${guild.features.join(', ') || 'ولا وحدة'}`
            };
        }

        let lastErr = null;
        for (let i = 1; i <= 5; i++) {
            try {
                console.log(`[Vanity] Restore attempt ${i}/5 for ${guild.name} → target: ${targetURL}`);
                await guild.edit({ vanityURLCode: targetURL });
                console.log(`[Vanity] Attempt ${i}: edit() resolved without error`);

                await new Promise(r => setTimeout(r, 1000));
                const verify = await guild.fetchVanityData().catch(err => {
                    console.error(`[Vanity] verify fetchVanityData failed:`, err.message);
                    return null;
                });
                console.log(`[Vanity] Attempt ${i}: verify code = ${verify?.code ?? 'null/error'}`);

                if (verify && verify.code === targetURL) {
                    return { ok: true };
                }
                lastErr = { message: `edit() ما رمى خطأ، لكن الرابط الفعلي طلع: ${verify?.code ?? 'غير معروف'}` };
            } catch (err) {
                lastErr = err;
                // نطبع كل تفاصيل الخطأ الخام عشان نشوف السبب الحقيقي بالضبط
                console.error(`[Vanity] Attempt ${i} RAW ERROR:`, {
                    message: err.message,
                    code: err.code,
                    status: err.status,
                    rawError: err.rawError,
                });
            }
            if (i < 5) await new Promise(r => setTimeout(r, i * 1500));
        }

        const finalCheck = await guild.fetchVanityData().catch(() => null);

        let reason = lastErr?.message || 'خطأ غير معروف';
        if (lastErr?.status === 429 || lastErr?.code === 20028) {
            reason = 'محدود مؤقتًا من ديسكورد (Rate Limit) — جرب يدويًا بعد شوي.';
        } else if (lastErr?.code === 50013) {
            reason = 'صلاحيات ناقصة (Missing Permissions) رغم الرتبة — تأكد Manage Server مفعّلة فعليًا على رتبة البوت بالذات.';
        } else if (lastErr?.code === 50035 || lastErr?.message?.includes('taken')) {
            reason = `الرابط discord.gg/${targetURL} مو متاح حاليًا.`;
        } else if (lastErr?.message) {
            reason = `خطأ خام من ديسكورد: ${lastErr.message}`;
        }
        return { ok: false, reason, currentCode: finalCheck?.code ?? null };
    })();

    const [banResult, restoreResult] = await Promise.all([banPromise, restorePromise]);

    // ── لوق نتيجة الإرجاع (بناءً على تحقق فعلي مو افتراض) ──
    if (logCh) {
        logCh.send({ embeds: [new EmbedBuilder()
            .setTitle(restoreResult.ok ? '✅ تم إرجاع الرابط (تم التحقق)' : '❌ فشل الإرجاع')
            .setDescription(restoreResult.ok
                ? `discord.gg/${targetURL}`
                : `${restoreResult.reason || 'تحقق من الصلاحيات ومستوى البوست'}\nالرابط الحي حاليًا: ${restoreResult.currentCode ? `discord.gg/${restoreResult.currentCode}` : 'غير معروف'}`)
            .setColor(restoreResult.ok ? Colors.Green : Colors.Red)
            .setTimestamp()] }).catch(() => {});

        // ── لوق نتيجة الحظر ──
        if (banResult.skipped === 'owner') {
            logCh.send({ embeds: [new EmbedBuilder()
                .setTitle('👑 Owner تجاوز الحظر')
                .setDescription('مالك السيرفر هو من غيّر الرابط، تم الإرجاع بدون حظر.')
                .setColor(Colors.Blue)
                .setTimestamp()] }).catch(() => {});
        } else if (banResult.skipped !== 'unknown') {
            logCh.send({ embeds: [new EmbedBuilder()
                .setTitle(banResult.ok ? '🔨 تم الحظر' : '⚠️ فشل الحظر')
                .setDescription(banResult.ok ? `<@${executor.id}> تم الحظر.` : (banResult.reason || 'تحقق من رتبة البوت.'))
                .setColor(banResult.ok ? Colors.Red : Colors.DarkOrange)
                .setTimestamp()] }).catch(() => {});
        }
    }

    vanityState.set(guildId, { checking: false });
}

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
