require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تحديد روم لوق الحماية')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('اختر روم اللوق')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('setvanity')
        .setDescription('تحديد رابط السيرفر المخصص للحماية')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('اكتب الرابط بدون discord.gg/ مثلاً: ab10')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('vanity-protect')
        .setDescription('تفعيل/تعطيل حماية رابط السيرفر')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('تفعيل أو تعطيل')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('عرض إعدادات البوت الحالية')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('جاري نشر السلاش كوماند عالمياً...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('تم نشر السلاش كوماند في كل السيرفرات!');
    } catch (error) {
        console.error('خطأ في النشر:', error);
    }
})();
