const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const JWT_SECRET = "super_secret_key_change_this_in_production";

const MONGO_URI = "mongodb+srv://biar:XaneKath1@kirobox-api.mreewnr.mongodb.net/?appName=kirobox-api";

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB Connected");
        seedAdmin();
        seedSiteConfig();
    })
    .catch(err => console.error("❌ DB Error:", err));

// --- SCHEMAS ---

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    nickname: { type: String },
    bio: { type: String, maxlength: 500, default: '' },
    profilePhoto: { type: String, default: '' },
    profileBanner: { type: String, default: '' }, // NEW: Profile banner image
    profileSticker: { type: String, default: '' }, // NEW: Sticker/GIF on profile
    profileEffect: { type: String, default: '' }, // NEW: Profile effect (snow, sparkles, etc.)
    profileBadge: { type: String, default: '' }, // NEW: Profile badge
    country: { type: String },
    gender: { type: String },
    role: { type: String, default: 'user' },
    myList: [{ type: Number }],
    watchlist: [{ type: Number }],
    favorites: [{ type: Number }],
    createdAt: { type: Date, default: Date.now }
});

const episodeSchema = new mongoose.Schema({
    number: { type: Number, required: true },
    title: { type: String, default: "Episode" },
    language: { type: String, enum: ['english-dub', 'tagalog-dub', 'sub'], required: true },
    server1: { type: String, required: true },
    server2: { type: String }
});

const animeSchema = new mongoose.Schema({
    anilistId: { type: Number, required: true, unique: true },
    title: { romaji: String, english: String, native: String },
    description: String,
    coverImage: String,
    bannerImage: String,
    genres: [String],
    averageScore: Number,
    popularity: Number,
    status: String,
    seasonYear: Number,
    season: String, // NEW: WINTER, SPRING, SUMMER, FALL
    format: String,
    episodes: [episodeSchema],
    totalEpisodes: Number, // NEW: Total episode count
    duration: Number, // NEW: Episode duration in minutes
    startDate: { year: Number, month: Number, day: Number }, // NEW
    endDate: { year: Number, month: Number, day: Number }, // NEW
    source: String, // NEW: MANGA, LIGHT_NOVEL, ORIGINAL, etc.
    studios: [String],
    producers: [String], // NEW
    tags: [{ name: String, rank: Number }], // NEW: Tags with popularity rank
    trailer: { id: String, site: String }, // NEW: YouTube trailer
    externalLinks: [{ site: String, url: String }], // NEW: MAL, Crunchyroll, etc.
    streamingOn: [String], // NEW: Where to watch
    viewCount: { type: Number, default: 0 }, // Simple view counter
    lastUpdated: { type: Date, default: Date.now }
});

const siteConfigSchema = new mongoose.Schema({
    spotlight: [{ type: Number }],
    trending: [{ type: Number }],
    topAiring: [{ type: Number }],
    mostPopular: [{ type: Number }],
    mostWatched: [{ type: Number }]
});

const wishlistRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    anilistId: { type: Number, required: true },
    animeTitle: { type: String, required: true },
    animeCoverImage: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date }
});

const User = mongoose.model('User', userSchema);
const Anime = mongoose.model('Anime', animeSchema);
const SiteConfig = mongoose.model('SiteConfig', siteConfigSchema);
const WishlistRequest = mongoose.model('WishlistRequest', wishlistRequestSchema);

// --- HELPERS ---

async function seedAdmin() {
    const adminExists = await User.findOne({ username: 'kiro' });
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('XaneKath1', 10);
        await User.create({ username: 'kiro', password: hashedPassword, role: 'admin' });
        console.log("🔒 Admin Account Created: kiro");
    }
}

async function seedSiteConfig() {
    const config = await SiteConfig.findOne();
    if (!config) {
        await SiteConfig.create({ 
            spotlight: [], 
            trending: [], 
            topAiring: [], 
            mostPopular: [],
            mostWatched: [] 
        });
        console.log("⚙️ Site Config Initialized");
    } else if (!config.mostWatched) {
        config.mostWatched = [];
        await config.save();
        console.log("⚙️ Most Watched Section Added");
    }
}

function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "No token provided" });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Unauthorized" });
        req.user = decoded;
        next();
    });
}

function optionalToken(req, res, next) {
    const token = req.headers['authorization'];
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (!err) req.user = decoded;
        });
    }
    next();
}

function verifyAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Require Admin Role" });
    next();
}

function formatScore(score) {
    if (!score) return null;
    return parseFloat((score / 10).toFixed(1));
}

function formatAnimeResponse(anime) {
    if (!anime) return null;
    const obj = anime.toObject ? anime.toObject() : anime;
    if (obj.averageScore) {
        obj.averageScore = formatScore(obj.averageScore);
    }
    return obj;
}

async function fetchAndSyncAniList(id) {
    const query = `query ($id: Int) { 
        Media (id: $id, type: ANIME) { 
            id 
            title { romaji english native } 
            description 
            bannerImage 
            coverImage { extraLarge } 
            genres 
            averageScore 
            popularity 
            status 
            season
            seasonYear 
            format
            episodes
            duration
            source
            startDate { year month day }
            endDate { year month day }
            studios(isMain: true) { nodes { name } }
            producers: studios(isMain: false) { nodes { name } }
            tags { name rank }
            trailer { id site }
            externalLinks { site url }
            streamingEpisodes { site }
        } 
    }`;
    
    try {
        const res = await axios.post('https://graphql.anilist.co', { query, variables: { id } });
        const media = res.data.data.Media;
        if (!media) return null;

        const updateData = {
            anilistId: media.id,
            title: media.title,
            description: media.description,
            coverImage: media.coverImage.extraLarge,
            bannerImage: media.bannerImage || media.coverImage.extraLarge,
            genres: media.genres,
            averageScore: media.averageScore,
            popularity: media.popularity,
            status: media.status,
            season: media.season,
            seasonYear: media.seasonYear,
            format: media.format,
            totalEpisodes: media.episodes,
            duration: media.duration,
            source: media.source,
            startDate: media.startDate,
            endDate: media.endDate,
            studios: media.studios?.nodes?.map(s => s.name) || [],
            producers: media.producers?.nodes?.map(p => p.name) || [],
            tags: media.tags?.slice(0, 10).map(t => ({ name: t.name, rank: t.rank })) || [],
            trailer: media.trailer,
            externalLinks: media.externalLinks || [],
            streamingOn: media.streamingEpisodes ? [...new Set(media.streamingEpisodes.map(e => e.site))] : [],
            lastUpdated: Date.now()
        };

        return await Anime.findOneAndUpdate(
            { anilistId: media.id }, 
            { $set: updateData }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (e) { 
        console.error("AniList fetch error:", e.message);
        return null; 
    }
}

async function updateMostWatched() {
    try {
        const topAnime = await Anime.find({ viewCount: { $gt: 0 } })
            .sort({ viewCount: -1 })
            .limit(20)
            .select('anilistId');
        
        const config = await SiteConfig.findOne();
        if (config) {
            config.mostWatched = topAnime.map(a => a.anilistId);
            await config.save();
        }
    } catch (err) {
        console.error("Error updating most watched:", err);
    }
}

// --- AUTH ROUTES ---

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ error: "User not found" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: "Invalid Credentials" });
        const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, role: user.role, username: user.username });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, gender, country } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: "Username already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({ 
            username, 
            password: hashedPassword, 
            nickname: username,
            gender, 
            country 
        });
        const token = jwt.sign({ id: newUser._id, username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, message: "Registered successfully", token, username: newUser.username, role: newUser.role });
    } catch (err) {
        res.status(500).json({ error: "Registration failed" });
    }
});

app.get('/api/auth/verify', verifyToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// --- USER PROFILE ---

app.get('/api/user/profile', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const myListAnime = await Anime.find({ anilistId: { $in: user.myList || [] } })
            .select('anilistId title coverImage averageScore viewCount status');
        const watchlistAnime = await Anime.find({ anilistId: { $in: user.watchlist || [] } })
            .select('anilistId title coverImage averageScore viewCount status');
        const favoritesAnime = await Anime.find({ anilistId: { $in: user.favorites || [] } })
            .select('anilistId title coverImage averageScore viewCount status');

        res.json({
            username: user.username,
            nickname: user.nickname || user.username,
            bio: user.bio || '',
            profilePhoto: user.profilePhoto || '',
            profileBanner: user.profileBanner || '',
            profileSticker: user.profileSticker || '',
            profileEffect: user.profileEffect || '',
            profileBadge: user.profileBadge || '',
            country: user.country,
            gender: user.gender,
            joined: user.createdAt || user._id.getTimestamp(),
            myList: myListAnime.map(formatAnimeResponse),
            watchlist: watchlistAnime.map(formatAnimeResponse),
            favorites: favoritesAnime.map(formatAnimeResponse)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/user/profile', verifyToken, async (req, res) => {
    try {
        const { nickname, bio, profilePhoto, profileBanner, profileSticker, profileEffect, profileBadge } = req.body;
        const user = await User.findById(req.user.id);
        
        if (!user) return res.status(404).json({ error: "User not found" });
        
        if (nickname !== undefined) user.nickname = nickname;
        if (bio !== undefined) user.bio = bio.substring(0, 500);
        if (profilePhoto !== undefined) user.profilePhoto = profilePhoto;
        if (profileBanner !== undefined) user.profileBanner = profileBanner;
        if (profileSticker !== undefined) user.profileSticker = profileSticker;
        if (profileEffect !== undefined) user.profileEffect = profileEffect;
        if (profileBadge !== undefined) user.profileBadge = profileBadge;
        
        await user.save();
        
        res.json({ 
            success: true, 
            profile: {
                nickname: user.nickname,
                bio: user.bio,
                profilePhoto: user.profilePhoto,
                profileBanner: user.profileBanner,
                profileSticker: user.profileSticker,
                profileEffect: user.profileEffect,
                profileBadge: user.profileBadge
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get public profile (for viewing other users)
app.get('/api/user/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('-password');
        if (!user) return res.status(404).json({ error: "User not found" });
        
        const favoritesAnime = await Anime.find({ anilistId: { $in: user.favorites || [] } })
            .select('anilistId title coverImage averageScore')
            .limit(10);

        res.json({
            username: user.username,
            nickname: user.nickname || user.username,
            bio: user.bio || '',
            profilePhoto: user.profilePhoto || '',
            profileBanner: user.profileBanner || '',
            profileSticker: user.profileSticker || '',
            profileEffect: user.profileEffect || '',
            profileBadge: user.profileBadge || '',
            country: user.country,
            joined: user.createdAt || user._id.getTimestamp(),
            favorites: favoritesAnime.map(formatAnimeResponse),
            myListCount: user.myList?.length || 0,
            watchlistCount: user.watchlist?.length || 0,
            favoritesCount: user.favorites?.length || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- MY LIST ---

app.post('/api/user/mylist/add', verifyToken, async (req, res) => {
    try {
        const { anilistId } = req.body;
        const user = await User.findById(req.user.id);
        if (!user.myList.includes(anilistId)) {
            user.myList.push(anilistId);
            await user.save();
        }
        res.json({ success: true, myList: user.myList });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/mylist/remove', verifyToken, async (req, res) => {
    try {
        const { anilistId } = req.body;
        const user = await User.findById(req.user.id);
        user.myList = user.myList.filter(id => id !== anilistId);
        await user.save();
        res.json({ success: true, myList: user.myList });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/mylist/check/:anilistId', verifyToken, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.anilistId);
        const user = await User.findById(req.user.id);
        res.json({ inList: user.myList.includes(anilistId) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- WATCHLIST ---

app.post('/api/user/watchlist/add', verifyToken, async (req, res) => {
    try {
        const { anilistId } = req.body;
        const user = await User.findById(req.user.id);
        if (!user.watchlist) user.watchlist = [];
        if (!user.watchlist.includes(anilistId)) {
            user.watchlist.push(anilistId);
            await user.save();
        }
        res.json({ success: true, watchlist: user.watchlist });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/watchlist/remove', verifyToken, async (req, res) => {
    try {
        const { anilistId } = req.body;
        const user = await User.findById(req.user.id);
        user.watchlist = (user.watchlist || []).filter(id => id !== anilistId);
        await user.save();
        res.json({ success: true, watchlist: user.watchlist });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/watchlist/check/:anilistId', verifyToken, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.anilistId);
        const user = await User.findById(req.user.id);
        res.json({ inWatchlist: (user.watchlist || []).includes(anilistId) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- FAVORITES ---

app.post('/api/user/favorites/add', verifyToken, async (req, res) => {
    try {
        const { anilistId } = req.body;
        const user = await User.findById(req.user.id);
        if (!user.favorites) user.favorites = [];
        if (!user.favorites.includes(anilistId)) {
            user.favorites.push(anilistId);
            await user.save();
        }
        res.json({ success: true, favorites: user.favorites });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/favorites/remove', verifyToken, async (req, res) => {
    try {
        const { anilistId } = req.body;
        const user = await User.findById(req.user.id);
        user.favorites = (user.favorites || []).filter(id => id !== anilistId);
        await user.save();
        res.json({ success: true, favorites: user.favorites });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/favorites/check/:anilistId', verifyToken, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.anilistId);
        const user = await User.findById(req.user.id);
        res.json({ inFavorites: (user.favorites || []).includes(anilistId) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- VIEW TRACKING ---

app.post('/api/anime/:id/view', async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        const anime = await Anime.findOne({ anilistId });
        
        if (!anime) {
            return res.status(404).json({ error: "Anime not found" });
        }
        
        // Simple increment - no user tracking
        anime.viewCount = (anime.viewCount || 0) + 1;
        await anime.save();
        
        // Update most watched section periodically
        if (anime.viewCount % 10 === 0) { // Update every 10 views
            updateMostWatched();
        }
        
        res.json({ success: true, viewCount: anime.viewCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/anime/:id/views', async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        const anime = await Anime.findOne({ anilistId }).select('viewCount');
        
        if (!anime) {
            return res.json({ viewCount: 0 });
        }
        
        res.json({ viewCount: anime.viewCount || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- WISHLIST REQUESTS ---

app.post('/api/user/wishlist-request', verifyToken, async (req, res) => {
    try {
        const { anilistId, animeTitle, animeCoverImage } = req.body;
        
        if (!anilistId || !animeTitle) {
            return res.status(400).json({ error: "Anime ID and title are required" });
        }
        
        const existingAnime = await Anime.findOne({ anilistId });
        if (existingAnime) {
            return res.json({ 
                success: false, 
                exists: true,
                message: "This anime is already available in our library!" 
            });
        }
        
        const existing = await WishlistRequest.findOne({ 
            userId: req.user.id, 
            anilistId, 
            status: 'pending' 
        });
        
        if (existing) {
            return res.json({ 
                success: true, 
                message: "You've already requested this anime. We'll notify you once it's added!" 
            });
        }
        
        await WishlistRequest.create({
            userId: req.user.id,
            username: req.user.username,
            anilistId,
            animeTitle,
            animeCoverImage
        });
        
        res.json({ 
            success: true, 
            message: "Thank you for your request! We'll review and add this anime soon. You'll be notified once it's available." 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/wishlist-request/check/:anilistId', verifyToken, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.anilistId);
        
        const anime = await Anime.findOne({ anilistId });
        if (anime) {
            return res.json({ requested: false, exists: true });
        }
        
        const request = await WishlistRequest.findOne({ 
            userId: req.user.id, 
            anilistId, 
            status: 'pending' 
        });
        
        res.json({ requested: !!request, exists: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/wishlist-requests', verifyToken, async (req, res) => {
    try {
        const requests = await WishlistRequest.find({ userId: req.user.id })
            .sort({ requestedAt: -1 });
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- HOME DATA ---

app.get('/api/home', async (req, res) => {
    try {
        const config = await SiteConfig.findOne();
        if (!config) {
            return res.json({ 
                spotlight: [], 
                trending: [], 
                topAiring: [], 
                mostPopular: [],
                mostWatched: []
            });
        }
        
        const getDetails = async (ids) => {
            if (!ids.length) return [];
            const animes = await Anime.find({ anilistId: { $in: ids } }).select('-episodes');
            return ids.map(id => {
                const anime = animes.find(a => a.anilistId === id);
                return anime ? formatAnimeResponse(anime) : null;
            }).filter(Boolean);
        };
        
        const [spotlight, trending, topAiring, mostPopular, mostWatched] = await Promise.all([
            getDetails(config.spotlight),
            getDetails(config.trending),
            getDetails(config.topAiring),
            getDetails(config.mostPopular),
            getDetails(config.mostWatched || [])
        ]);
        
        res.json({ spotlight, trending, topAiring, mostPopular, mostWatched });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// --- ANIME DETAILS ---

app.get('/api/anime/:id', optionalToken, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        let anime = await Anime.findOne({ anilistId });
        
        if (!anime) {
            anime = await fetchAndSyncAniList(anilistId);
            if (!anime) return res.status(404).json({ error: "Anime not found" });
        }
        
        let inMyList = false;
        let inWatchlist = false;
        let inFavorites = false;
        
        if (req.user) {
            const user = await User.findById(req.user.id);
            if (user) {
                inMyList = user.myList.includes(anilistId);
                inWatchlist = (user.watchlist || []).includes(anilistId);
                inFavorites = (user.favorites || []).includes(anilistId);
            }
        }
        
        res.json({ 
            ...formatAnimeResponse(anime), 
            inMyList,
            inWatchlist,
            inFavorites
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SEARCH ---

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    try {
        const regex = new RegExp(q, 'i');
        const results = await Anime.find({
            $or: [
                { 'title.english': regex },
                { 'title.romaji': regex },
                { 'title.native': regex }
            ]
        }).select('-episodes').limit(20);
        
        res.json(results.map(formatAnimeResponse));
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/anime/search/library', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    try {
        const regex = new RegExp(q, 'i');
        const results = await Anime.find({
            $or: [
                { 'title.english': regex },
                { 'title.romaji': regex },
                { 'title.native': regex }
            ]
        }).select('-episodes').limit(20);
        res.json(results.map(formatAnimeResponse));
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/search/anilist', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    const query = `query ($search: String) { Page(page: 1, perPage: 15) { media(search: $search, type: ANIME, sort: POPULARITY_DESC) { id title { romaji english } coverImage { large } seasonYear format status genres averageScore } } }`;
    try {
        const r = await axios.post('https://graphql.anilist.co', { query, variables: { search: q } });
        const results = r.data.data.Page.media.map(anime => ({
            ...anime,
            averageScore: formatScore(anime.averageScore)
        }));
        
        const anilistIds = results.map(a => a.id);
        const existingAnime = await Anime.find({ anilistId: { $in: anilistIds } }).select('anilistId');
        const existingIds = existingAnime.map(a => a.anilistId);
        
        const enrichedResults = results.map(anime => ({
            ...anime,
            inLibrary: existingIds.includes(anime.id)
        }));
        
        res.json(enrichedResults);
    } catch (e) { 
        res.json([]); 
    }
});

app.get('/api/anime/library/all', async (req, res) => {
    try {
        const animes = await Anime.find().select('-episodes').sort({ lastUpdated: -1 }).limit(50);
        res.json(animes.map(formatAnimeResponse));
    } catch (err) {
        res.json([]);
    }
});

// --- GENRES ---

app.get('/api/genres', async (req, res) => {
    const genres = [
        "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", 
        "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological",
        "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"
    ];
    res.json(genres);
});

app.get('/api/genre/:genre', async (req, res) => {
    const { genre } = req.params;
    const page = parseInt(req.query.page) || 1;
    
    try {
        const regex = new RegExp(genre, 'i');
        const results = await Anime.find({ genres: regex })
            .select('-episodes')
            .sort({ popularity: -1 })
            .skip((page - 1) * 20)
            .limit(20);
        
        res.json(results.map(formatAnimeResponse));
    } catch (err) {
        res.json([]);
    }
});

// --- LATEST ---

app.get('/api/latest', async (req, res) => {
    try {
        const results = await Anime.find({ status: 'RELEASING' })
            .select('-episodes')
            .sort({ lastUpdated: -1 })
            .limit(30);
        
        res.json(results.map(formatAnimeResponse));
    } catch (err) {
        res.json([]);
    }
});

// --- ADMIN ROUTES ---

app.get('/api/admin/search', verifyToken, verifyAdmin, async (req, res) => {
    const { q } = req.query;
    const query = `query ($search: String) { Page(page: 1, perPage: 15) { media(search: $search, type: ANIME, sort: POPULARITY_DESC) { id title { romaji english } coverImage { medium } seasonYear format } } }`;
    try {
        const r = await axios.post('https://graphql.anilist.co', { query, variables: { search: q } });
        res.json(r.data.data.Page.media);
    } catch (e) { 
        res.json([]); 
    }
});

app.get('/api/admin/config', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const config = await SiteConfig.findOne();
        
        const getDetails = async (ids) => {
            if (!ids.length) return [];
            const animes = await Anime.find({ anilistId: { $in: ids } }).select('anilistId title coverImage viewCount');
            return ids.map(id => animes.find(a => a.anilistId === id)).filter(Boolean);
        };
        
        const [spotlight, trending, topAiring, mostPopular, mostWatched] = await Promise.all([
            getDetails(config.spotlight),
            getDetails(config.trending),
            getDetails(config.topAiring),
            getDetails(config.mostPopular),
            getDetails(config.mostWatched || [])
        ]);
        
        res.json({ spotlight, trending, topAiring, mostPopular, mostWatched });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/config/section', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { section, anilistId, action } = req.body;
        
        if (action === 'add') {
            await fetchAndSyncAniList(anilistId);
        }
        
        const config = await SiteConfig.findOne();
        let list = config[section] || [];
        
        if (action === 'add' && !list.includes(anilistId)) {
            list.push(anilistId);
        } else if (action === 'remove') {
            list = list.filter(id => id !== anilistId);
        }
        
        config[section] = list;
        await config.save();
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/refresh-most-watched', verifyToken, verifyAdmin, async (req, res) => {
    try {
        await updateMostWatched();
        res.json({ success: true, message: "Most watched section updated" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/anime/:id/episodes', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        let anime = await Anime.findOne({ anilistId });
        
        if (!anime) {
            anime = await fetchAndSyncAniList(anilistId);
        }
        
        if (!anime) return res.status(404).json({ error: "Anime not found" });
        
        res.json({ 
            anime: {
                anilistId: anime.anilistId,
                title: anime.title,
                coverImage: anime.coverImage,
                viewCount: anime.viewCount || 0,
                totalEpisodes: anime.totalEpisodes,
                status: anime.status
            },
            episodes: anime.episodes || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/anime/:id/episode', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        const { number, title, language, server1, server2 } = req.body;
        
        let anime = await Anime.findOne({ anilistId });
        if (!anime) {
            anime = await fetchAndSyncAniList(anilistId);
        }
        
        if (!anime) return res.status(404).json({ error: "Anime not found" });
        
        const existingIndex = anime.episodes.findIndex(e => e.number === number && e.language === language);
        
        if (existingIndex >= 0) {
            anime.episodes[existingIndex] = { number, title, language, server1, server2 };
        } else {
            anime.episodes.push({ number, title, language, server1, server2 });
        }
        
        anime.episodes.sort((a, b) => a.number - b.number);
        
        await anime.save();
        res.json({ success: true, episodes: anime.episodes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/anime/:id/episodes/batch', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        const { episodes, language } = req.body;

        if (!episodes) return res.status(400).json({ error: "No episodes provided" });

        let anime = await Anime.findOne({ anilistId });
        if (!anime) {
            anime = await fetchAndSyncAniList(anilistId);
        }
        
        if (!anime) return res.status(404).json({ error: "Anime not found" });

        const lines = episodes.split('\n');
        let addedCount = 0;
        let updatedCount = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const match = trimmed.match(/^(\d+)\s*[.\-:]\s*(.+)$/);
            
            if (match) {
                const number = parseInt(match[1]);
                const server1 = match[2].trim();

                const existingIndex = anime.episodes.findIndex(e => e.number === number && e.language === language);

                if (existingIndex >= 0) {
                    anime.episodes[existingIndex].server1 = server1;
                    updatedCount++;
                } else {
                    anime.episodes.push({
                        number,
                        title: `Episode ${number}`,
                        language,
                        server1
                    });
                    addedCount++;
                }
            }
        }

        anime.episodes.sort((a, b) => a.number - b.number);
        
        await anime.save();
        res.json({ success: true, added: addedCount, updated: updatedCount });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/anime/:id/episode/:episodeId', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const anilistId = parseInt(req.params.id);
        const episodeId = req.params.episodeId;
        
        const anime = await Anime.findOne({ anilistId });
        if (!anime) return res.status(404).json({ error: "Anime not found" });
        
        anime.episodes = anime.episodes.filter(e => e._id.toString() !== episodeId);
        await anime.save();
        
        res.json({ success: true, episodes: anime.episodes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/user/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user.role === 'admin') {
            return res.status(400).json({ error: "Cannot delete admin" });
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/wishlist-requests', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const status = req.query.status || 'pending';
        const requests = await WishlistRequest.find({ status })
            .populate('userId', 'username')
            .sort({ requestedAt: -1 });
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/wishlist-request/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }
        
        const request = await WishlistRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ error: "Request not found" });
        
        request.status = status;
        request.processedAt = new Date();
        await request.save();
        
        if (status === 'approved') {
            await fetchAndSyncAniList(request.anilistId);
        }
        
        res.json({ success: true, message: `Request ${status}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalAnime = await Anime.countDocuments();
        const pendingRequests = await WishlistRequest.countDocuments({ status: 'pending' });
        const totalViews = await Anime.aggregate([
            { $group: { _id: null, total: { $sum: "$viewCount" } } }
        ]);
        const config = await SiteConfig.findOne();
        
        res.json({
            totalUsers,
            totalAnime,
            totalViews: totalViews.length > 0 ? totalViews[0].total : 0,
            pendingRequests,
            spotlightCount: config?.spotlight?.length || 0,
            trendingCount: config?.trending?.length || 0,
            topAiringCount: config?.topAiring?.length || 0,
            mostPopularCount: config?.mostPopular?.length || 0,
            mostWatchedCount: config?.mostWatched?.length || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/most-watched', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const mostWatched = await Anime.find({ viewCount: { $gt: 0 } })
            .select('anilistId title coverImage viewCount totalEpisodes status')
            .sort({ viewCount: -1 })
            .limit(limit);
        
        res.json(mostWatched.map(formatAnimeResponse));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
