const fs = require('fs');

for (const file of ['sidepanel.html', 'sidepanel.js']) {
    let content = fs.readFileSync(file, 'utf8');

    // Remove emojis
    content = content.replace(/⚡ /g, '');

    // Replace <svg>...</svg> globally where possible.
    // In sidepanel.html, the nav tabs icons:
    content = content.replace(/<svg viewBox="0 0 24 24"[\s\S]*?<\/svg>/g, '');
    
    // In sidepanel.html, the empty-icon svgs:
    content = content.replace(/<div class="empty-icon">.*?<\/div>/g, '');

    // In sidepanel.js empty icons
    content = content.replace(/<div class="empty-icon">.*?<\/div>/g, '');

    // In sidepanel.html brand-icon svg:
    content = content.replace(/<div class="brand-icon">.*?<\/div>/g, '');

    // Replace ibtns with text
    content = content.replace(/<button class="ibtn" id="btn-clear".*?<\/button>/g, '<button class="abtn" id="btn-clear">Clear</button>');
    content = content.replace(/<button class="ibtn" id="btn-reload".*?<\/button>/g, '<button class="abtn" id="btn-reload">Reload</button>');
    content = content.replace(/<button class="ibtn" id="btn-refresh-storage".*?<\/button>/g, '<button class="abtn" id="btn-refresh-storage">Refresh</button>');

    // In sidepanel.js ibtn (Copy button)
    content = content.replace(/<button class="ibtn" onclick="copyJson(.*?)".*?<\/button>/g, '<button class="abtn" onclick="copyJson$1">Copy JSON</button>');
    
    // Mocks delete button
    content = content.replace(/<button class="ibtn" onclick="delMock(.*?)".*?<\/button>/g, '<button class="abtn" onclick="delMock$1">Delete</button>');

    // In sidepanel.js abtns that have svg inside
    content = content.replace(/<button class="abtn" onclick="copyCurl(.*?)">.*?cURL<\/button>/g, '<button class="abtn" onclick="copyCurl$1">cURL</button>');
    content = content.replace(/<button class="abtn" onclick="copyFetch(.*?)">.*?Fetch<\/button>/g, '<button class="abtn" onclick="copyFetch$1">Fetch</button>');
    content = content.replace(/<button class="abtn" onclick="genTS(.*?)">.*?Gen TS<\/button>/g, '<button class="abtn" onclick="genTS$1">Gen TS</button>');
    content = content.replace(/<button class="abtn primary" onclick="\$\('.nav-tab\[data-dt=\\'sandbox\\'\\]'\)\.click\(\)">.*?Edit<\/button>/g, '<button class="abtn primary" onclick="$(\'.nav-tab[data-dt=\\\'sandbox\\\']\').click()">Edit</button>');
    content = content.replace(/<button class="abtn primary" onclick="runSandbox\(\)"(.*?)>.*?Send Request<\/button>/gs, '<button class="abtn primary" onclick="runSandbox()"$1>Send Request</button>');

    // detail view back button
    content = content.replace(/<button class="abtn" id="btn-back">.*?Back to list<\/button>/gs, '<button class="abtn" id="btn-back">Back to list</button>');
    content = content.replace(/innerHTML = '<svg.*?>.*?<\/svg> Back to list'/g, 'innerHTML = "Back to list"');
    
    // search input
    content = content.replace(/<div class="search-wrap">.*?<input/gs, '<div class="search-wrap"><input');

    // Dashboard click fix
    content = content.replace(/<div class="grp-head" style="margin-bottom:4px">/g, '<div class="grp-head" style="margin-bottom:4px; cursor:pointer;" title="Filter Feed" onclick="setSearchFilter(\'${escAttr(g.path)}\')">');

    fs.writeFileSync(file, content);
}
