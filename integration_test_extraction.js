
const repoUrl = 'https://github.com/navidshad/SoloDev-Social-Engine';
const repoName = 'navidshad/SoloDev-Social-Engine';
const readmeContent = `# SoloDev Social Engine


![SoloDev Social Engine Cover](cover.png)

SoloDev Social Engine is a serverless, AI-powered hub...`;

function extractImages(content, repoUrl, defaultBranch) {
    const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
    const htmlImageRegex = /<img.*?src=["'](.*?)["'].*?>/g;
    const images = [];

    const matches = [...content.matchAll(markdownImageRegex), ...content.matchAll(htmlImageRegex)];
    for (const m of matches) {
        images.push(processImagePath(m[1], repoUrl, defaultBranch));
    }

    return images.filter(img => img.startsWith('http'));
}

function processImagePath(path, repoUrl, defaultBranch) {
    if (path.startsWith('http')) return path;
    
    if (repoUrl && repoUrl.includes('github.com')) {
        const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
        if (match) {
            const fullRepo = match[1].replace(/\/$/, '');
            const branch = defaultBranch || 'main';
            const rawBase = `https://raw.githubusercontent.com/${fullRepo}/${branch}/`;
            return rawBase + path.replace(/^\.\//, '').replace(/^\//, '');
        }
    }
    
    return path;
}

async function testFlow() {
    console.log('--- Testing Image Extraction Logic ---');
    const images = extractImages(readmeContent, repoUrl);
    console.log('Extracted Images:', images);
    
    if (images.length > 0) {
        console.log('SUCCESS: Image extracted correctly.');
        console.log('URL:', images[0]);
    } else {
        console.log('FAILURE: No images extracted.');
    }

    console.log('\n--- Checking Repo URL Matcher ---');
    const urlsToTest = [
        'https://github.com/navidshad/SoloDev-Social-Engine',
        'https://github.com/navidshad/SoloDev-Social-Engine/',
        'github.com/navidshad/SoloDev-Social-Engine'
    ];
    
    urlsToTest.forEach(url => {
        const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
        console.log(`URL: ${url} | Match: ${match ? match[1] : 'NONE'}`);
    });
}

testFlow();
