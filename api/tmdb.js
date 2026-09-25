const axios = require('axios');

const TMDB_BASE_URL = 'https://api.themoviedb.org';

// 你的 TMDB 代理正式域名
const TMDB_PROXY_URL = 'https://tmdb.zutomayo.club';

// 创建缓存对象
const cache = new Map();

// 缓存过期时间（10分钟）
const CACHE_DURATION = 10 * 60 * 1000;

// 最大缓存条目数
const MAX_CACHE_SIZE = 1000;

// 缓存清理函数
function cleanExpiredCache() {
    const now = Date.now();

    for (const [key, value] of cache.entries()) {
        if (now > value.expiry) {
            cache.delete(key);
        }
    }
}

// 检查缓存大小并清理最旧的条目
function checkCacheSize() {
    if (cache.size > MAX_CACHE_SIZE) {
        const entries = Array.from(cache.entries());

        entries.sort((a, b) => a[1].expiry - b[1].expiry);

        const deleteCount = cache.size - MAX_CACHE_SIZE;

        entries
            .slice(0, deleteCount)
            .forEach(([key]) => cache.delete(key));

        console.log(`Cleaned ${deleteCount} old cache entries`);
    }
}

// 定期清理缓存（每10分钟）
setInterval(cleanExpiredCache, CACHE_DURATION);

module.exports = async (req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    );

    // 处理 OPTIONS 请求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const fullPath = req.url;
        const authHeader = req.headers.authorization;

        // 缓存键使用请求路径
        const cacheKey = fullPath;

        // 检查缓存
        if (cache.has(cacheKey)) {
            const cachedData = cache.get(cacheKey);

            if (Date.now() < cachedData.expiry) {
                console.log('Cache hit:', fullPath);

                return res
                    .status(200)
                    .json(cachedData.data);
            } else {
                cache.delete(cacheKey);
            }
        }

        // 构建 TMDB 请求 URL
        const tmdbUrl = `${TMDB_BASE_URL}${fullPath}`;

        // 构建请求配置
        const config = {};

        // Jellyfin 使用 Authorization 时继续转发
        if (authHeader) {
            config.headers = {
                'Authorization': authHeader
            };
        }

        // 请求真正的 TMDB
        const response = await axios.get(tmdbUrl, config);

        // 单独保存返回数据，便于修改
        const responseData = response.data;

        /*
         * Jellyfin 会调用：
         *
         * /3/configuration
         *
         * TMDB 原本会返回：
         *
         * https://image.tmdb.org/t/p/
         *
         * 这里把图片 Base URL 改成自己的代理：
         *
         * https://tmdb.zutomayo.club/t/p/
         */
        if (
            fullPath.startsWith('/3/configuration') &&
            responseData &&
            responseData.images
        ) {
            const proxyImageBase =
                `${TMDB_PROXY_URL}/t/p/`;

            responseData.images.base_url =
                proxyImageBase;

            responseData.images.secure_base_url =
                proxyImageBase;

            console.log(
                'TMDB image base URL replaced:',
                proxyImageBase
            );
        }

        // 只有响应状态码为 200 时才缓存
        if (response.status === 200) {
            checkCacheSize();

            cache.set(cacheKey, {
                data: responseData,
                expiry: Date.now() + CACHE_DURATION
            });

            console.log(
                'Cache miss and stored:',
                fullPath
            );
        } else {
            console.log(
                'Response not cached due to non-200 status:',
                response.status
            );
        }

        // 返回经过处理的数据
        res
            .status(response.status)
            .json(responseData);

    } catch (error) {
        console.error(
            'TMDB API error:',
            error
        );

        res
            .status(error.response?.status || 500)
            .json({
                error: error.message,
                details: error.response?.data
            });
    }
};
