# RFC-001: Sprite Animation Quality Rules

## Status: Active
## Date: 2025

## Problem
AI-generated sprite sheet animations frequently violate quality rules:
1. Frames face different directions (flipping/mirroring)
2. Frame sizes are inconsistent
3. Frames are too close together or overlapping
4. AI generates grids instead of horizontal strips
5. Character proportions change between frames

## Rules

### R1: Facing Direction Lock
Every frame in an animation strip MUST face the same direction as the reference character image. This is the most commonly violated rule. Every animation prompt MUST include:
- A dedicated "FACING RULE" paragraph
- Explicit reminder at Frame 3 and Frame 4: "Character still faces the SAME direction as Frame 1"
- The words "Do NOT flip, mirror, or turn"

### R2: Horizontal Strip Layout
Animation output MUST be a wide horizontal image (4:1+ aspect ratio) with exactly 4 poses in ONE row. Prompts must:
- Explicitly say "WIDE horizontal image"
- Say "NOT a grid, NOT stacked, ONE single row"
- Require wide green gaps between poses

### R3: Consistent Frame Size
All 4 frames must have the same pixel scale and proportions as the reference. The sprite compiler normalizes sizes post-generation, but prompts should still request "same size as reference."

### R4: Green Background
Background MUST be solid #00FF00 green. No gradients, no shadows, no ground lines. This is required for chroma key removal.

### R5: Idle is Code-Generated
Idle animation MUST NOT use AI generation. It is created by duplicating the base character image 4 times with vertical pixel offsets. This guarantees:
- Perfect facing consistency
- Identical proportions
- No API cost
- No flipping bugs

### R6: Chroma Key Safety
Background removal MUST:
- Use flood fill from edges (not global scan)
- Require green to be the dominant channel (g >= r && g >= b)
- Use per-channel tolerance (not Euclidean distance)
- Never remove pixels where red or blue is dominant
- Include a strict pass for trapped green in small gaps
- Include defringe passes for anti-aliased edges

### R7: Frame Extraction Robustness
The sprite compiler MUST handle:
- Properly separated frames (column gap detection)
- Frames stuck together (equal-width horizontal slicing fallback)
- Grid layouts (2x2 quadrant splitting when image is square)
- Size normalization across all rows to the tallest row's height

## Verification Checklist
When modifying animation generation or sprite compilation:
- [ ] All 4 frames face the same direction
- [ ] Frames are separated with visible gaps
- [ ] Frame sizes are normalized in the final sprite sheet
- [ ] Chroma key preserves non-green character colors (yellow hair, green clothing)
- [ ] Idle animation uses code duplication, not AI
- [ ] Grid fallback handles square AI outputs
