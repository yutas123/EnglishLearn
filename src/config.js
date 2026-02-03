import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export const ALBUM_DB_ID = process.env.ALBUM_DB_ID;
export const TRACK_DB_ID = process.env.TRACK_DB_ID;
