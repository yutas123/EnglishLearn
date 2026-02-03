import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export const ALBUM_DB_ID = process.env.ALBUM_DB_ID;
export const TRACK_DB_ID = process.env.TRACK_DB_ID;

// Genius API
export const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;

// OpenAI API
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
