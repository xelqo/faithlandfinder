// GET -> the rules (names, fixes, rights) so the page can show them before any scan
import { RULES } from "../lib/scan.js";
export default function handler(req, res) {
  res.status(200).json(RULES);
}
