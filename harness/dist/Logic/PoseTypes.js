export function clonePose(pose) {
    const out = {};
    for (const id in pose) {
        const jp = pose[id];
        out[id] = {
            p: { x: jp.p.x, y: jp.p.y, z: jp.p.z },
            r: { x: jp.r.x, y: jp.r.y, z: jp.r.z, w: jp.r.w },
        };
    }
    return out;
}
export function cloneKeyframe(kf) {
    return { t: kf.t, joints: clonePose(kf.joints) };
}
