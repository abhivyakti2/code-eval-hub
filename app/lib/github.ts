const GITHUB_API='https://api.github.com';

const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept:'application/vnd.github+json',
    'X-Github_Api_Version':'2022-11-28',
};

export function parseGithubUrl(url: string) : {owner: string; repo: string}{
    //regular expression (regex) to extract parts of GitHub URL
    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if(!match) throw new Error('Invalid Github URL');
    return {owner: match[1], repo: match[2]};
}

export async function fetchRepoMetadata(owner: string, repo: string) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

export async function fetchContributors(owner: string, repo: string) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=30`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json() as Promise<
    { login: string; avatar_url: string; contributions: number }[]
  >;
}

export async function fetchCommitsByContributor(owner: string, repo: string, login: string, since?: string){
    const url= new URL(`${GITHUB_API}/repos/${owner}/${repo}/commits`);
    url.searchParams.set('author', login);
    url.searchParams.set('per_page', '100');
    if (since) url.searchParams.set('since', since);

    const res=await fetch(url.toString(),{headers});
    if(!res.ok) throw new Error(`Github API error: ${res.status}`);
    return res.json() as Promise<
        {sha:string; commit:{message: string; author: {date: string}}}[]
    >;
}

export async function fetchFileTree(owner:string, repo:string, sha='HEAD'){
    const res= await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
        { headers}
    );
    if(!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data=await res.json();
    return (data.tree as {path: string; type: string; sha: string; size: number}[])
        .filter((item)=> item.type === 'blob' && item.size< 50_000); // Filter only blobs (files), exclude large files
}

export async function fetchFileContent(owner:string, repo:string, path:string): Promise<string>{
    const res= await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, 
        { headers }
    ); //encodeURIComponent is used to encode the file path, especially if it contains special characters or spaces, to ensure it is correctly interpreted in the URL.
    if(!res.ok) return ''; //why different from other functions? Because some files may be binary or too large, we can choose to return empty string instead of throwing error
    const data= await res.json();
    if(data.encoding === 'base64'){
        return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return data.content ?? '';
}

export async function fetchLatestCommitSha(owner: string, repo: string): Promise<string> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/HEAD`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json(); 
  // .json does what? It parses the response body as JSON and returns a JavaScript object. 
  // In this case, it will return an object representing the latest commit, 
  // which includes various properties such as 'sha', 'commit', 'author', etc. 
  // We specifically want to extract the 'sha' property from this object to get the latest commit's SHA hash.
  return data.sha as string;
}