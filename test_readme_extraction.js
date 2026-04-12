
const repoUrl = 'https://github.com/navidshad/SoloDev-Social-Engine';
const readmeContent = `# SoloDev Social Engine


![SoloDev Social Engine Cover](cover.png)

SoloDev Social Engine is a serverless, AI-powered hub...`;

function processImagePath(path, repoUrl) {
    if (path.startsWith('http')) return path;
    
    if (repoUrl && repoUrl.includes('github.com')) {
        // Extract owner/repo from URL to be safe
        const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
        if (match) {
            const fullRepo = match[1].replace(/\/$/, '');
            const rawBase = `https://raw.githubusercontent.com/${fullRepo}/main/`;
            return rawBase + path.replace(/^\.\//, '').replace(/^\//, '');
        }
    }
    
    return path;
}

function extractImages(content, repoUrl) {
    const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
    const htmlImageRegex = /<img.*?src=["'](.*?)["'].*?>/g;
    const images = [];

    const matches = [...content.matchAll(markdownImageRegex), ...content.matchAll(htmlImageRegex)];
    console.log('Total matches found:', matches.length);
    for (const m of matches) {
        console.log('Match found:', m[0]);
        console.log('Path extracted:', m[1]);
        const processed = processImagePath(m[1], repoUrl);
        console.log('Processed path:', processed);
        images.push(processed);
    }

    const finalImages = images.filter(img => img.startsWith('http'));
    return finalImages;
}

console.log('Testing extraction...');
const results = extractImages(readmeContent, repoUrl);
console.log('Final Results:', results);
