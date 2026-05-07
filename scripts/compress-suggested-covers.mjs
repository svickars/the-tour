/**
 * Resize + recompress JPEGs in `public/suggested-places/`.
 * Expects filenames `public/suggested-places/<place-id>.jpg` (matches `SuggestedPlace.id`).
 *
 * Usage: pnpm compress:suggested-places
 */
import { readdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

const DIR = path.join(process.cwd(), 'public/suggested-places')
const MAX_EDGE = 1120
const JPEG_QUALITY = 78

async function main() {
  const names = await readdir(DIR)
  const jpgs = names.filter((n) => /\.jpe?g$/i.test(n) && !n.startsWith('.'))

  if (jpgs.length === 0) {
    console.warn('No JPEGs found in', DIR)
    return
  }

  for (const file of jpgs) {
    const inputPath = path.join(DIR, file)
    const tmpPath = path.join(DIR, `.tmp-compress-${file}`)

    const meta = await sharp(inputPath).metadata()
    const before = (await stat(inputPath)).size

    await sharp(inputPath)
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(tmpPath)

    await unlink(inputPath)
    await rename(tmpPath, inputPath)

    const after = (await stat(inputPath)).size
    const pct = before ? Math.round((1 - after / before) * 100) : 0
    console.log(
      `${file}: ${meta.width}×${meta.height} → ${(before / 1024).toFixed(0)} KiB → ${(after / 1024).toFixed(0)} KiB (−${pct}%)`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
