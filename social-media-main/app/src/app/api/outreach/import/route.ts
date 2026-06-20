import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";

// Known field variants → canonical Prospect field name
const FIELD_ALIASES: Record<string, string> = {
  // fullName
  fullname: "fullName",
  full_name: "fullName",
  name: "fullName",
  contactname: "fullName",
  person: "fullName",
  // firstName
  firstname: "firstName",
  first_name: "firstName",
  givenname: "firstName",
  // headline
  headline: "headline",
  title: "headline",
  jobtitle: "headline",
  job_title: "headline",
  position: "headline",
  role: "headline",
  // company
  company: "company",
  companyname: "company",
  company_name: "company",
  organization: "company",
  employer: "company",
  // jobTitle (secondary to headline)
  occupation: "jobTitle",
  // location
  location: "location",
  city: "location",
  country: "location",
  region: "location",
  // profileUrl
  profileurl: "profileUrl",
  profile_url: "profileUrl",
  linkedinurl: "profileUrl",
  linkedin_url: "profileUrl",
  linkedin: "profileUrl",
  url: "profileUrl",
  // email
  email: "email",
  emailaddress: "email",
  email_address: "email",
  // bio
  bio: "bio",
  about: "bio",
  summary: "bio",
  description: "bio",
  aboutme: "bio",
  // website
  website: "website",
  websiteurl: "website",
  website_url: "website",
  homepage: "website",
  // followers
  followers: "followers",
  followercount: "followers",
  follower_count: "followers",
  connections: "followers",
};

// dev_fusion/linkedin-profile-scraper known column names
const LINKEDIN_SCRAPER_PRESET: Record<string, string> = {
  fullName: "fullName",
  firstName: "firstName",
  lastName: "fullName", // merge with firstName if fullName absent
  headline: "headline",
  company: "company",
  jobTitle: "headline",
  location: "location",
  profileUrl: "profileUrl",
  linkedInUrl: "profileUrl",
  email: "email",
  about: "bio",
  summary: "bio",
  website: "website",
  followers: "followers",
  connectionsCount: "followers",
};

function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[\s_\-\.]/g, "");
}

function suggestMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const norm = normaliseKey(h);
    // Check exact preset match first (LinkedIn scraper)
    if (LINKEDIN_SCRAPER_PRESET[h]) {
      mapping[h] = LINKEDIN_SCRAPER_PRESET[h];
    } else if (FIELD_ALIASES[norm]) {
      mapping[h] = FIELD_ALIASES[norm];
    }
    // Unmapped headers left out — client will show them as "skip / rawData"
  }
  return mapping;
}

export async function POST(req: Request) {
  try {
    const { csvText, listName } = (await req.json()) as {
      csvText: string;
      listName: string;
    };

    if (!csvText?.trim()) {
      return NextResponse.json({ error: "No CSV content provided" }, { status: 400 });
    }

    const rows = parse(csvText, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
    }) as Record<string, string>[];

    if (!rows.length) {
      return NextResponse.json({ error: "CSV is empty or has no data rows" }, { status: 400 });
    }

    const headers = Object.keys(rows[0]);
    const suggested = suggestMapping(headers);

    // Return first 5 rows as preview
    const preview = rows.slice(0, 5);

    return NextResponse.json({
      headers,
      totalRows: rows.length,
      preview,
      suggested,
      listName,
      // Pass the full row data back so client doesn't need to re-upload
      rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `CSV parse error: ${msg}` }, { status: 400 });
  }
}
