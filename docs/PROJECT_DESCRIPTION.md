# Reel Life — project description

## What it is

Reel Life is a spatial stop-motion animation studio for Snap Spectacles. You
describe a character out loud, it is sculpted as a jointed puppet and dropped
onto your real table, and you animate it with your hands — posing limbs one frame
at a time, exactly like a stop-motion animator working an armature, except the
puppet appeared from a sentence thirty seconds ago and the timeline floats in the
air beside it.

The full loop, start to finish, takes about three minutes:

1. **Speak** — "a clay dragon in a top hat"
2. **Place** — point at your desk, pause, pinch
3. **Pose** — grab a wing, move it, tap Capture. Ghosts of your last poses stay
   on screen so you can see the arc you're building
4. **Cut** — chips on a floating timeline, drag to reorder, drag the edges to
   trim, tap to speak a caption
5. **Play** — the reel plays back in AR, tweened, scored, captioned, on the beat

## How it answers the Create theme

The theme asks for a spatial tool that helps people create something faster,
easier, or more intuitively. Stop-motion animation is the clearest possible case
of a craft that is *only* hard because of its tooling: the ideas are cheap, the
armature, the rig, the lighting, the capture software and the edit are what take
weeks. Reel Life collapses that to minutes, and does it by using space rather
than in spite of it.

Three things are genuinely easier here than anywhere else:

**Posing is direct.** No viewport, no gizmo, no inverse-kinematics solver you
have to argue with. The puppet is on your table at real scale and you move its
arm with your hand. This is the one thing AR is unambiguously better at than a
screen, and animation is the application where that difference is worth the most.

**The armature is free.** Describing a character produces a jointed puppet, not a
static prop — the description is decomposed into limbs, each generated
separately, each independently posable. Getting a riggable character normally
costs you a modeller and a rigger.

**The edit is in the room.** Takes are chips floating next to the puppet. Reorder
by dragging. Trim by dragging an edge. There's no export-import round trip
between "making it" and "cutting it", which is where most short-form animation
projects actually die.

And one thing that is not just easier but *better*: because the app knows the
tempo you posed at and the tempo of the score, it snaps your poses onto the beat.
A shaky hand-posed performance comes back as choreography. That is a thing the
spatial tool can do for you that neither a screen nor a physical armature can.

## Who it's for

Anyone who has ever wanted to make a little animated thing and bounced off the
tooling. Kids and parents on a kitchen table. Teachers running an animation unit
without a camera rig. Short-form creators who want a character piece that doesn't
look like everyone else's. And working animators, for whom this is the fastest
possible way to block out a performance before committing it to a real pipeline.

## What's honest about it

"Play Reel" plays your finished reel live in AR. It does not export an MP4 —
there is no documented way for a Lens to render and write a video file, so the
app doesn't pretend otherwise. You get a shareable file the way every Spectacles
demo does: screen recording. The UI says this in plain language rather than
dressing a screen-record prompt up as an export button.
