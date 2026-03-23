import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN;
const DEFAULT_USERNAME = "aman12334";
const CUSTOM_USERS_STORAGE_KEY = "cyberCity.customUsers.v2";
const ACCENT_PALETTE = ["#22d3ee", "#a78bfa", "#f472b6"];

const VISUAL_PRESETS = {
  dystopian: {
    label: "Dystopian Night",
    bg: "#06070d",
    fogColor: "#0a0b12",
    fogNear: 54,
    fogFarMul: 2.75,
    ambient: 0.26,
    hemiSky: "#1e293b",
    hemiGround: "#020202",
    hemiIntensity: 0.15,
    dirAColor: "#38bdf8",
    dirAIntensity: 0.34,
    dirBColor: "#f97316",
    dirBIntensity: 0.2,
    centerColor: "#ef4444",
    centerIntensity: 0.45,
    groundColor: "#05060a",
    gridCellColor: "#10222f",
    gridSectionColor: "#7f1d1d",
    bloomIntensity: 0.48,
    bloomThreshold: 0.72,
  },
  tron: {
    label: "Tron Neon",
    bg: "#010814",
    fogColor: "#020b1f",
    fogNear: 62,
    fogFarMul: 3.1,
    ambient: 0.3,
    hemiSky: "#15314a",
    hemiGround: "#010309",
    hemiIntensity: 0.2,
    dirAColor: "#22d3ee",
    dirAIntensity: 0.48,
    dirBColor: "#a78bfa",
    dirBIntensity: 0.24,
    centerColor: "#06b6d4",
    centerIntensity: 0.6,
    groundColor: "#020617",
    gridCellColor: "#0f3346",
    gridSectionColor: "#22d3ee",
    bloomIntensity: 0.62,
    bloomThreshold: 0.67,
  },
  dawn: {
    label: "Dawn Haze",
    bg: "#151826",
    fogColor: "#1f2438",
    fogNear: 76,
    fogFarMul: 3.45,
    ambient: 0.45,
    hemiSky: "#334155",
    hemiGround: "#10131f",
    hemiIntensity: 0.22,
    dirAColor: "#7dd3fc",
    dirAIntensity: 0.4,
    dirBColor: "#fb923c",
    dirBIntensity: 0.34,
    centerColor: "#f59e0b",
    centerIntensity: 0.38,
    groundColor: "#0f172a",
    gridCellColor: "#1e3a5f",
    gridSectionColor: "#f59e0b",
    bloomIntensity: 0.42,
    bloomThreshold: 0.78,
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

function normalizeUser(detail) {
  return {
    username: detail.login,
    profileUrl: detail.html_url,
    posts: detail.public_repos ?? 0,
    activityScore: detail.followers ?? 0,
  };
}

function dedupeUsers(users) {
  const byUsername = new Map();
  users.forEach((user) => {
    if (!user?.username) return;
    byUsername.set(user.username.toLowerCase(), user);
  });
  return [...byUsername.values()];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, ms, fallbackValue = null) {
  let done = false;
  const timeoutPromise = sleep(ms).then(() => {
    if (!done) return fallbackValue;
    return fallbackValue;
  });
  const result = await Promise.race([promise, timeoutPromise]);
  done = true;
  return result;
}

async function runInBatches(items, batchSize, runner) {
  const output = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(chunk.map((item) => runner(item)));
    for (let j = 0; j < settled.length; j += 1) {
      const entry = settled[j];
      if (entry.status === "fulfilled" && entry.value) output.push(entry.value);
    }
  }
  return output;
}

function addGlow(users) {
  if (users.length === 0) return users;
  const min = Math.min(...users.map((u) => u.activityScore));
  const max = Math.max(...users.map((u) => u.activityScore));
  const range = Math.max(1, max - min);

  return users.map((user) => ({
    ...user,
    glow: 0.3 + ((user.activityScore - min) / range) * 0.95,
  }));
}

function transformUsersToCity(users) {
  const sorted = [...users].sort((a, b) => b.activityScore - a.activityScore);
  const total = Math.max(1, sorted.length);
  const golden = Math.PI * (3 - Math.sqrt(5));

  const positioned = sorted.map((user, index) => {
    const t = index / Math.max(1, total - 1);
    const ringBias = ((index % 3) - 1) * 1.4;
    const radius = 8 + Math.pow(t, 1.7) * 112 + ringBias;
    const angle = index * golden;
    const jitter = (hashString(user.username) % 9) * 0.12;

    return {
      ...user,
      x: Math.cos(angle) * (radius + jitter),
      z: Math.sin(angle) * (radius + jitter),
    };
  });

  return addGlow(positioned);
}

function readRateInfo(headers) {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const resetRaw = headers.get("x-ratelimit-reset");
  const resetEpoch = resetRaw ? Number(resetRaw) * 1000 : null;

  return {
    limit: limit ? Number(limit) : null,
    remaining: remaining ? Number(remaining) : null,
    resetEpoch,
  };
}

async function fetchGitHubUser(username, onRate) {
  const response = await fetch(`https://api.github.com/users/${username}`, {
    headers: getHeaders(),
  });

  onRate?.(readRateInfo(response.headers), response.status);

  if (response.status === 404) return null;
  if (!response.ok) return null;

  return normalizeUser(await response.json());
}

function getBrowserCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation unavailable"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 4500, maximumAge: 300000 }
    );
  });
}

async function reverseGeocodeCoordinates(lat, lng) {
  const response = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
  );
  if (!response.ok) return null;

  const json = await response.json();
  const city =
    json.city ||
    json.locality ||
    json.principalSubdivision ||
    json.localityInfo?.informative?.[0]?.name ||
    "";
  const region = json.principalSubdivision || "";
  const country = json.countryName || "";

  const terms = dedupeUsers(
    [city, `${city} ${region}`.trim(), region, country]
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean)
      .map((term) => ({ username: term }))
  ).map((x) => x.username);

  return { city, region, country, terms };
}

async function fetchUsersByLocationTerms(terms, onRate, maxUsers = 60) {
  const uniqueTerms = [...new Set((terms || []).map((t) => t.trim()).filter(Boolean))].slice(0, 5);
  const candidateMap = new Map();

  for (let i = 0; i < uniqueTerms.length && candidateMap.size < maxUsers; i += 1) {
    const term = uniqueTerms[i];
    const query = encodeURIComponent(`location:\"${term}\"`);
    const response = await fetch(
      `https://api.github.com/search/users?q=${query}&per_page=60`,
      { headers: getHeaders() }
    );
    onRate?.(readRateInfo(response.headers), response.status);
    if (!response.ok) continue;

    const data = await response.json();
    const items = data.items || [];
    for (let j = 0; j < items.length && candidateMap.size < maxUsers; j += 1) {
      const item = items[j];
      if (!item?.login || !item?.url) continue;
      candidateMap.set(item.login.toLowerCase(), item.url);
    }
  }

  const urls = [...candidateMap.values()].slice(0, maxUsers);
  const users = await runInBatches(urls, 8, async (url) => {
    const detailResponse = await fetch(url, { headers: getHeaders() });
    onRate?.(readRateInfo(detailResponse.headers), detailResponse.status);
    if (!detailResponse.ok) return null;
    return normalizeUser(await detailResponse.json());
  });

  return dedupeUsers(users).slice(0, maxUsers);
}

function HelicopterModel({ helicopterStateRef }) {
  const rootRef = useRef(null);
  const mainRotorRef = useRef(null);
  const tailRotorRef = useRef(null);

  useFrame((_, delta) => {
    const root = rootRef.current;
    const state = helicopterStateRef.current;
    if (!root || !state) return;

    root.position.copy(state.position);
    root.rotation.set(0, state.yaw, state.bank * 0.75);

    if (mainRotorRef.current) mainRotorRef.current.rotation.y += 24 * delta;
    if (tailRotorRef.current) tailRotorRef.current.rotation.x += 34 * delta;
  });

  return (
    <group ref={rootRef} scale={[1.15, 1.15, 1.15]}>
      <mesh>
        <capsuleGeometry args={[0.52, 2.1, 5, 12]} />
        <meshStandardMaterial color="#1e293b" metalness={0.55} roughness={0.34} />
      </mesh>

      <mesh position={[0, 0.06, 1.38]}>
        <boxGeometry args={[0.8, 0.5, 0.8]} />
        <meshStandardMaterial color="#38bdf8" emissive="#06b6d4" emissiveIntensity={0.45} />
      </mesh>

      <mesh position={[0, 0.1, 1.88]}>
        <sphereGeometry args={[0.11, 10, 10]} />
        <meshStandardMaterial color="#dbeafe" emissive="#67e8f9" emissiveIntensity={0.9} />
      </mesh>

      <mesh position={[0, 0.24, -1.95]}>
        <boxGeometry args={[0.14, 0.14, 1.98]} />
        <meshStandardMaterial color="#475569" metalness={0.46} roughness={0.42} />
      </mesh>

      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.33, 10]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>

      <mesh ref={mainRotorRef} position={[0, 0.86, 0]}>
        <boxGeometry args={[4.6, 0.04, 0.16]} />
        <meshStandardMaterial color="#e2e8f0" emissive="#67e8f9" emissiveIntensity={0.35} />
      </mesh>

      <mesh ref={tailRotorRef} position={[0, 0.16, -2.88]}>
        <boxGeometry args={[0.04, 0.62, 0.14]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>

      <mesh position={[0.46, -0.52, 0]}>
        <boxGeometry args={[0.08, 0.08, 2.45]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>

      <mesh position={[-0.46, -0.52, 0]}>
        <boxGeometry args={[0.08, 0.08, 2.45]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
    </group>
  );
}

function HoverRig({
  buildings,
  cityRadius,
  onCrash,
  helicopterStateRef,
  focusPoint,
  onTelemetry,
  mobileInputRef,
}) {
  const { camera } = useThree();
  const velocity = useRef(new THREE.Vector3());
  const verticalVelocity = useRef(0);
  const heliPos = useRef(new THREE.Vector3(0, 42, cityRadius + 40));
  const heliYaw = useRef(Math.PI);
  const keys = useRef({
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    Space: false,
    ShiftLeft: false,
    ShiftRight: false,
    KeyE: false,
    KeyQ: false,
    KeyR: false,
  });
  const keyAliases = useRef({
    e: "KeyE",
    E: "KeyE",
    q: "KeyQ",
    Q: "KeyQ",
    " ": "Space",
    Spacebar: "Space",
    Shift: "ShiftLeft",
    r: "KeyR",
    R: "KeyR",
  });
  const forward = useRef(new THREE.Vector3());
  const move = useRef(new THREE.Vector3());
  const desiredCam = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3(0, 1, 0));
  const bank = useRef(0);
  const crashCooldown = useRef(0);
  const nearCollisionTime = useRef(0);
  const lookYaw = useRef(0);
  const lookPitch = useRef(0);
  const targetLookYaw = useRef(0);
  const targetLookPitch = useRef(0);
  const lookDragActive = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const telemetryWindow = useRef({ t: 0, frames: 0 });

  useEffect(() => {
    heliPos.current.set(0, 42, cityRadius + 40);
    heliYaw.current = Math.PI;
    camera.position.set(0, 47, cityRadius + 52);
    camera.lookAt(0, 42, cityRadius + 40);
    camera.updateProjectionMatrix();
  }, [camera, cityRadius]);

  useEffect(() => {
    if (!focusPoint) return;

    const safeOffsetX = 40;
    const safeOffsetZ = -34;
    const targetY = clamp((focusPoint.y || 0) + 40, 34, 180);

    heliPos.current.set(focusPoint.x + safeOffsetX, targetY, focusPoint.z + safeOffsetZ);
    heliYaw.current = Math.atan2(focusPoint.x - heliPos.current.x, focusPoint.z - heliPos.current.z);

    velocity.current.set(0, 0, 0);
    verticalVelocity.current = 0;
    nearCollisionTime.current = 0;
    crashCooldown.current = 2.2;
  }, [focusPoint]);

  useEffect(() => {
    const isTypingTarget = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    };

    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      const code = event.code || keyAliases.current[event.key] || event.key;
      if (!(code in keys.current)) return;
      keys.current[code] = true;
      event.preventDefault();
    };

    const onKeyUp = (event) => {
      if (isTypingTarget(event.target)) return;
      const code = event.code || keyAliases.current[event.key] || event.key;
      if (!(code in keys.current)) return;
      keys.current[code] = false;
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const isCanvasTarget = (target) => {
      if (!target) return false;
      return target.tagName === "CANVAS" || target.closest?.("canvas");
    };

    const onPointerDown = (event) => {
      if (!isCanvasTarget(event.target)) return;
      if (event.pointerType !== "touch" && event.button !== 2 && event.button !== 1) return;
      lookDragActive.current = true;
      lastMouse.current.x = event.clientX;
      lastMouse.current.y = event.clientY;
      event.preventDefault();
    };

    const onPointerUp = (event) => {
      if (event.pointerType !== "touch" && event.button !== 2 && event.button !== 1) return;
      lookDragActive.current = false;
      targetLookYaw.current = 0;
      targetLookPitch.current = 0;
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!lookDragActive.current) return;
      const dx = event.clientX - lastMouse.current.x;
      const dy = event.clientY - lastMouse.current.y;
      lastMouse.current.x = event.clientX;
      lastMouse.current.y = event.clientY;
      targetLookYaw.current = clamp(targetLookYaw.current - dx * 0.004, -1.1, 1.1);
      targetLookPitch.current = clamp(targetLookPitch.current + dy * 0.004, -1.2, 0.85);
    };

    const onContextMenu = (event) => {
      if (isCanvasTarget(event.target)) event.preventDefault();
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("contextmenu", onContextMenu);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  useFrame((_, delta) => {
    crashCooldown.current = Math.max(0, crashCooldown.current - delta);

    const keyboardTurn = (keys.current.ArrowLeft ? 1 : 0) - (keys.current.ArrowRight ? 1 : 0);
    const keyboardThrust = (keys.current.ArrowUp ? 1 : 0) - (keys.current.ArrowDown ? 1 : 0);
    const keyboardLift =
      (keys.current.Space || keys.current.KeyE ? 1 : 0) -
      (keys.current.ShiftLeft || keys.current.ShiftRight || keys.current.KeyQ ? 1 : 0);
    const mobileTurn =
      (mobileInputRef?.current?.tiltTurn ?? 0) + (mobileInputRef?.current?.manualTurn ?? 0);
    const mobileThrust =
      (mobileInputRef?.current?.tiltThrust ?? 0) + (mobileInputRef?.current?.manualThrust ?? 0);
    const mobileLift = mobileInputRef?.current?.lift ?? 0;

    const turnInput = clamp(keyboardTurn + mobileTurn, -1, 1);
    const thrustInput = clamp(keyboardThrust + mobileThrust, -1, 1);
    const liftInput = clamp(keyboardLift + mobileLift, -1, 1);

    if (keys.current.KeyR) {
      targetLookYaw.current = 0;
      targetLookPitch.current = 0;
      keys.current.KeyR = false;
    }

    heliYaw.current += turnInput * 1.46 * delta;
    forward.current.set(Math.sin(heliYaw.current), 0, Math.cos(heliYaw.current)).normalize();

    move.current.copy(forward.current).multiplyScalar(thrustInput * 40);
    velocity.current.lerp(move.current, clamp(delta * 4.8, 0, 1));
    heliPos.current.addScaledVector(velocity.current, delta);

    const maxXY = cityRadius + 48;
    heliPos.current.x = clamp(heliPos.current.x, -maxXY, maxXY);
    heliPos.current.z = clamp(heliPos.current.z, -maxXY, maxXY);

    const minY = 8;
    const maxY = 250;
    let desiredVertical = liftInput * 24;

    if (heliPos.current.y < minY + 0.4) {
      desiredVertical = Math.max(desiredVertical, (minY - heliPos.current.y) * 12);
    }
    if (heliPos.current.y > maxY - 0.4) {
      desiredVertical = Math.min(desiredVertical, -(heliPos.current.y - maxY) * 6);
    }

    verticalVelocity.current = THREE.MathUtils.lerp(
      verticalVelocity.current,
      desiredVertical,
      clamp(delta * 4.8, 0, 1)
    );

    heliPos.current.y += verticalVelocity.current * delta;
    heliPos.current.y = clamp(heliPos.current.y, minY, maxY);

    if (crashCooldown.current <= 0) {
      const heliRadius = 0.62;
      const graceRadius = 1.15;
      let nearCollision = false;
      let hardCollision = false;
      let nearestBuilding = null;
      let nearestDistSq = Number.POSITIVE_INFINITY;

      for (let i = 0; i < buildings.length; i += 1) {
        const b = buildings[i];
        const dx = heliPos.current.x - b.x;
        const dz = heliPos.current.z - b.z;
        const adx = Math.abs(dx);
        const adz = Math.abs(dz);
        const halfW = b.width * 0.5;
        const halfD = b.depth * 0.5;

        const withinNearX = adx < halfW + heliRadius + graceRadius;
        const withinNearZ = adz < halfD + heliRadius + graceRadius;
        const withinY = heliPos.current.y > 4 && heliPos.current.y < b.height + heliRadius + 1.6;

        if (withinNearX && withinNearZ && withinY) {
          nearCollision = true;
          const distSq = dx * dx + dz * dz;
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearestBuilding = b;
          }

          const withinHardX = adx < halfW + heliRadius;
          const withinHardZ = adz < halfD + heliRadius;
          const withinHardY = heliPos.current.y > 4 && heliPos.current.y < b.height + heliRadius;
          if (withinHardX && withinHardZ && withinHardY) hardCollision = true;
        }
      }

      if (nearCollision) {
        nearCollisionTime.current = Math.min(2, nearCollisionTime.current + delta);

        if (nearestBuilding) {
          const push = new THREE.Vector3(
            heliPos.current.x - nearestBuilding.x,
            0,
            heliPos.current.z - nearestBuilding.z
          );
          if (push.lengthSq() < 0.0001) push.set(1, 0, 0);
          push.normalize();

          heliPos.current.addScaledVector(push, 12 * delta);
          const dot = velocity.current.dot(push);
          if (dot < 12) {
            velocity.current.addScaledVector(push, (12 - dot) * 0.4);
          }
          velocity.current.multiplyScalar(0.92);
        }

        if (hardCollision && nearCollisionTime.current > 0.58) {
          heliPos.current.set(0, 42, cityRadius + 40);
          heliYaw.current = Math.PI;
          velocity.current.set(0, 0, 0);
          verticalVelocity.current = 0;
          nearCollisionTime.current = 0;
          crashCooldown.current = 1.3;
          onCrash?.();
        }
      } else {
        nearCollisionTime.current = Math.max(0, nearCollisionTime.current - delta * 2.4);
      }
    }

    bank.current = THREE.MathUtils.lerp(bank.current, -turnInput * 0.2, clamp(delta * 3.5, 0, 1));

    desiredCam.current
      .copy(heliPos.current)
      .addScaledVector(forward.current, -10.5)
      .add(new THREE.Vector3(0, 4.4, 0));
    camera.position.lerp(desiredCam.current, clamp(delta * 5.8, 0, 1));

    desiredLook.current
      .copy(heliPos.current)
      .addScaledVector(forward.current, 14)
      .add(new THREE.Vector3(0, 1.5, 0));

    right.current.crossVectors(forward.current, up.current).normalize();

    lookYaw.current = THREE.MathUtils.lerp(
      lookYaw.current,
      targetLookYaw.current,
      clamp(delta * 6, 0, 1)
    );
    lookPitch.current = THREE.MathUtils.lerp(
      lookPitch.current,
      targetLookPitch.current,
      clamp(delta * 6, 0, 1)
    );

    desiredLook.current.addScaledVector(right.current, lookYaw.current * 12);
    desiredLook.current.addScaledVector(up.current, -lookPitch.current * 10);

    camera.up.set(0, 1, 0);
    camera.lookAt(desiredLook.current);

    helicopterStateRef.current.position.copy(heliPos.current);
    helicopterStateRef.current.yaw = heliYaw.current;
    helicopterStateRef.current.bank = bank.current;
    helicopterStateRef.current.speed = velocity.current.length();

    telemetryWindow.current.t += delta;
    telemetryWindow.current.frames += 1;
    if (telemetryWindow.current.t > 0.2) {
      onTelemetry?.({
        x: heliPos.current.x,
        y: heliPos.current.y,
        z: heliPos.current.z,
        speed: velocity.current.length(),
        fps: telemetryWindow.current.frames / telemetryWindow.current.t,
      });
      telemetryWindow.current.t = 0;
      telemetryWindow.current.frames = 0;
    }
  });

  return null;
}

function HighlightBeacon({ building, strong }) {
  const ringRef = useRef(null);
  const beamRef = useRef(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const base = strong ? 1.05 : 0.72;
    const amp = strong ? 0.4 : 0.28;
    const pulse = base + Math.sin(t * 4.8) * amp;

    if (ringRef.current) {
      ringRef.current.rotation.y += 1.8 * delta;
      ringRef.current.scale.setScalar(pulse);
    }

    if (beamRef.current?.material) {
      beamRef.current.material.opacity = strong ? 0.42 + pulse * 0.24 : 0.18 + pulse * 0.18;
    }
  });

  if (!building) return null;

  return (
    <group position={[building.x, building.height + 2.2, building.z]}>
      <pointLight color="#22c55e" intensity={strong ? 14 : 9} distance={strong ? 130 : 95} decay={1.8} />
      <mesh ref={beamRef}>
        <cylinderGeometry args={[1.1, 1.1, strong ? 36 : 26, 24, 1, true]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ringRef} rotation-x={Math.PI / 2} position={[0, -4.8, 0]}>
        <torusGeometry args={[2.6, 0.18, 12, 40]} />
        <meshBasicMaterial color="#4ade80" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.28, 14, 14]} />
        <meshBasicMaterial color="#86efac" />
      </mesh>
    </group>
  );
}

function Buildings({
  buildings,
  focusedUser,
  highlightedUsername,
  onSelectBuilding,
  helicopterPosition,
  labelDistance,
  searchAssist,
}) {
  const normalizedHighlight = highlightedUsername?.trim().toLowerCase() || null;

  const tallestUsername = useMemo(() => {
    if (buildings.length === 0) return null;
    return buildings.reduce((maxUser, user) =>
      user.activityScore > maxUser.activityScore ? user : maxUser
    ).username;
  }, [buildings]);

  const highlightedBuilding = useMemo(() => {
    if (!normalizedHighlight) return null;
    return buildings.find((b) => b.username.toLowerCase() === normalizedHighlight) || null;
  }, [buildings, normalizedHighlight]);

  return (
    <>
      {buildings.map((user) => {
        const isTallest = user.username === tallestUsername;
        const isFocused =
          focusedUser && focusedUser.username?.toLowerCase() === user.username.toLowerCase();
        const isHighlighted = normalizedHighlight && normalizedHighlight === user.username.toLowerCase();

        const accentColor = isHighlighted
          ? "#22c55e"
          : ACCENT_PALETTE[hashString(user.username) % ACCENT_PALETTE.length];

        const coreColor = isHighlighted
          ? "#14532d"
          : isFocused
            ? "#1d4ed8"
            : isTallest
              ? "#111827"
              : user.tier === "core"
                ? "#0b1326"
                : user.tier === "mid"
                  ? "#0a1222"
                  : "#090f1d";

        const neonColor = isHighlighted ? "#22c55e" : isFocused ? "#f59e0b" : accentColor;

        const dx = helicopterPosition.x - user.x;
        const dz = helicopterPosition.z - user.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const lod = dist > 220 ? 2 : dist > 120 ? 1 : 0;

        const showLabel =
          isHighlighted || isFocused || isTallest || (dist <= labelDistance && lod === 0);
        const edgeOpacity = isHighlighted ? 0.9 : isTallest ? 0.18 : user.tier === "core" ? 0.12 : 0.06;

        return (
          <group
            key={user.username.toLowerCase()}
            position={[user.x, user.height / 2 + (isHighlighted ? 1.2 : 0), user.z]}
            onClick={() => onSelectBuilding(user)}
          >
            {isHighlighted ? (
              <pointLight
                color="#22c55e"
                intensity={searchAssist ? 14 : 10}
                distance={searchAssist ? 120 : 82}
                decay={1.7}
              />
            ) : null}
            {isTallest ? (
              <pointLight color="#38bdf8" intensity={2.2} distance={80} decay={2} />
            ) : null}

            <mesh>
              <boxGeometry args={[user.width, user.height, user.depth]} />
              <meshStandardMaterial
                color={coreColor}
                metalness={0.35}
                roughness={0.86}
                emissive={isHighlighted ? "#16a34a" : "#000000"}
                emissiveIntensity={isHighlighted ? (searchAssist ? 2.2 : 1.8) : isTallest ? 0.06 : 0}
                toneMapped={!isHighlighted}
              />
            </mesh>

            <mesh position={[0, -user.height * 0.5 - 0.16, 0]}>
              <boxGeometry args={[user.width * 1.06, 0.26, user.depth * 1.06]} />
              <meshStandardMaterial color="#060b16" roughness={1} metalness={0.05} />
            </mesh>

            {lod < 2 ? (
              <mesh position={[0, user.height * 0.5 + 0.14, 0]}>
                <boxGeometry args={[user.width * 1.02, 0.18, user.depth * 1.02]} />
                <meshStandardMaterial
                  color={accentColor}
                  emissive={accentColor}
                  emissiveIntensity={isHighlighted ? (searchAssist ? 1.45 : 1.1) : isTallest ? 0.5 : 0.26}
                  roughness={0.48}
                  metalness={0.2}
                  toneMapped={!isHighlighted}
                />
              </mesh>
            ) : null}

            {lod === 0 ? (
              <mesh position={[0, user.height * 0.42, 0]}>
                <boxGeometry
                  args={[user.width * 0.84, Math.max(0.2, user.height * 0.05), user.depth * 0.84]}
                />
                <meshStandardMaterial
                  color="#0b2230"
                  emissive={neonColor}
                  emissiveIntensity={isHighlighted ? 1.2 : isTallest ? 0.52 : 0.18}
                  roughness={0.34}
                  toneMapped={!isHighlighted}
                />
              </mesh>
            ) : null}

            {lod === 0 ? (
              <mesh position={[user.width * 0.52, 0, 0]}>
                <boxGeometry args={[0.12, user.height * 0.92, user.depth * 0.82]} />
                <meshStandardMaterial
                  color={accentColor}
                  emissive={accentColor}
                  emissiveIntensity={isHighlighted ? 1.3 : isTallest ? 0.42 : 0.12}
                  roughness={0.25}
                  metalness={0.2}
                  toneMapped={!isHighlighted}
                />
              </mesh>
            ) : null}

            {lod < 2 && (isHighlighted || isTallest || user.tier === "core") ? (
              <mesh scale={[1.035, 1.02, 1.035]}>
                <boxGeometry args={[user.width, user.height, user.depth]} />
                <meshBasicMaterial
                  color={neonColor}
                  wireframe
                  transparent
                  opacity={lod === 1 ? edgeOpacity * 0.72 : edgeOpacity}
                />
              </mesh>
            ) : null}

            {isHighlighted ? (
              <mesh scale={[1.26, 1.12, 1.26]} renderOrder={10}>
                <boxGeometry args={[user.width, user.height, user.depth]} />
                <meshBasicMaterial
                  color="#22c55e"
                  transparent
                  opacity={searchAssist ? 0.58 : 0.44}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>
            ) : null}

            {isHighlighted ? (
              <mesh position={[0, user.height * 0.52 + 1.2, 0]}>
                <sphereGeometry args={[0.45, 14, 14]} />
                <meshBasicMaterial color="#86efac" />
              </mesh>
            ) : null}

            {isTallest ? (
              <>
                <mesh position={[0, user.height * 0.5 + 1.7, 0]}>
                  <cylinderGeometry args={[0.1, 0.1, 3.2, 10]} />
                  <meshStandardMaterial color="#93c5fd" emissive="#38bdf8" emissiveIntensity={0.9} />
                </mesh>
                <mesh position={[0, user.height * 0.5 + 3.5, 0]}>
                  <sphereGeometry args={[0.2, 10, 10]} />
                  <meshBasicMaterial color="#67e8f9" />
                </mesh>
              </>
            ) : null}

            {showLabel ? (
              <Html
                position={[0, user.height * 0.52 + 2.2, 0]}
                transform
                sprite
                distanceFactor={28}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                <div
                  style={{
                    background: isHighlighted ? "rgba(34, 197, 94, 0.86)" : "rgba(2, 6, 23, 0.75)",
                    border: isHighlighted
                      ? "1px solid rgba(134, 239, 172, 0.95)"
                      : "1px solid rgba(34, 211, 238, 0.5)",
                    borderRadius: 6,
                    color: isHighlighted ? "#dcfce7" : "#bae6fd",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.2,
                    lineHeight: 1,
                    padding: "4px 6px",
                    whiteSpace: "nowrap",
                    textTransform: "none",
                  }}
                >
                  @{user.username}
                </div>
              </Html>
            ) : null}
          </group>
        );
      })}
      <HighlightBeacon building={highlightedBuilding} strong={searchAssist} />
    </>
  );
}

function CityScene({
  buildings,
  focusedUser,
  highlightedUsername,
  onSelectBuilding,
  onCrash,
  helicopterStateRef,
  cityRadius,
  focusPoint,
  onTelemetry,
  helicopterPosition,
  searchAssist,
  visual,
  mobileInputRef,
}) {
  const preset = VISUAL_PRESETS[visual] ?? VISUAL_PRESETS.dystopian;

  return (
    <>
      <color attach="background" args={[preset.bg]} />
      <fog attach="fog" args={[preset.fogColor, preset.fogNear, cityRadius * preset.fogFarMul]} />

      <ambientLight intensity={preset.ambient} />
      <hemisphereLight args={[preset.hemiSky, preset.hemiGround, preset.hemiIntensity]} />
      <directionalLight position={[130, 220, 70]} color={preset.dirAColor} intensity={preset.dirAIntensity} />
      <directionalLight
        position={[-80, 150, -120]}
        color={preset.dirBColor}
        intensity={preset.dirBIntensity}
      />
      <pointLight
        position={[0, 28, 0]}
        color={preset.centerColor}
        intensity={preset.centerIntensity}
        distance={cityRadius * 2.8}
      />

      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
        <planeGeometry args={[cityRadius * 6, cityRadius * 6]} />
        <meshStandardMaterial color={preset.groundColor} roughness={1} metalness={0} />
      </mesh>

      <Grid
        position={[0, 0.03, 0]}
        infiniteGrid
        cellSize={8}
        cellThickness={0.14}
        cellColor={preset.gridCellColor}
        sectionSize={32}
        sectionThickness={0.34}
        sectionColor={preset.gridSectionColor}
        fadeDistance={cityRadius * 6}
        fadeStrength={1}
      />

      <Buildings
        buildings={buildings}
        focusedUser={focusedUser}
        highlightedUsername={highlightedUsername}
        onSelectBuilding={onSelectBuilding}
        helicopterPosition={helicopterPosition}
        labelDistance={44}
        searchAssist={searchAssist}
      />

      <HelicopterModel helicopterStateRef={helicopterStateRef} />

      <HoverRig
        buildings={buildings}
        cityRadius={cityRadius}
        onCrash={onCrash}
        helicopterStateRef={helicopterStateRef}
        focusPoint={focusPoint}
        onTelemetry={onTelemetry}
        mobileInputRef={mobileInputRef}
      />

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={preset.bloomIntensity}
          luminanceThreshold={preset.bloomThreshold}
          luminanceSmoothing={0.24}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

function GameHud({ boom, isMobile }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 20,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "rgba(186, 230, 253, 0.95)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: isMobile ? 186 : 16,
          left: 16,
          border: "1px solid rgba(34, 211, 238, 0.9)",
          borderRadius: 12,
          padding: isMobile ? "10px 12px" : "14px 16px",
          fontSize: isMobile ? 12 : 17,
          lineHeight: isMobile ? 1.35 : 1.65,
          background: "rgba(2, 6, 23, 0.92)",
          maxWidth: isMobile ? 250 : 500,
          boxShadow: "0 14px 32px rgba(0,0,0,0.55)",
          color: "#e0f2fe",
        }}
      >
        <div style={{ fontSize: isMobile ? 14 : 20, fontWeight: 800, color: "#67e8f9", marginBottom: 8 }}>
          Flight Instructions
        </div>
        {isMobile ? (
          <>
            TILT: steer + move
            <br />
            TOUCH: use LEFT/RIGHT/FORWARD/BACK
            <br />
            HOLD UP/DOWN: altitude
          </>
        ) : (
          <>
            ARROWS: TURN + THRUST
            <br />
            E or SPACE: GO UP
            <br />
            Q or SHIFT: GO DOWN
            <br />
            RIGHT MOUSE DRAG: LOOK AROUND
            <br />
            RELEASE RMB or R: RECENTER VIEW
            <br />
            SEARCH BUILDING: highlight + camera assist
            <br />
            MINI-MAP: jump near highlighted tower
          </>
        )}
      </div>

      {boom ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at center, rgba(248,113,113,0.4), rgba(251,146,60,0.16), transparent 65%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "42%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: 4,
              color: "rgba(254, 202, 202, 0.95)",
              textShadow: "0 0 24px rgba(248, 113, 113, 0.9)",
            }}
          >
            BOOM
          </div>
        </>
      ) : null}
    </div>
  );
}

function MiniMap({ buildings, cityRadius, helicopter, highlightedBuilding, onJump, isMobile }) {
  const size = isMobile ? 138 : 220;
  const half = size / 2;
  const pad = 14;
  const scale = (value) => (value / (cityRadius + 8)) * (half - pad);

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: isMobile ? 18 : 18,
        zIndex: 32,
        width: isMobile ? 155 : 250,
        background: "rgba(2, 6, 23, 0.9)",
        border: "1px solid rgba(34, 211, 238, 0.6)",
        borderRadius: 12,
        padding: 10,
        boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
        color: "#bae6fd",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div style={{ fontSize: isMobile ? 12 : 15, fontWeight: 700, marginBottom: 8, color: "#67e8f9" }}>
        Mini Map
      </div>
      <svg width={size} height={size} style={{ display: "block", background: "#030712", borderRadius: 8 }}>
        <rect x="0" y="0" width={size} height={size} fill="#020617" />
        <circle cx={half} cy={half} r={half - 8} stroke="#0e7490" strokeWidth="1" fill="none" opacity="0.6" />

        {buildings.map((b) => {
          const x = half + scale(b.x);
          const y = half + scale(b.z);
          const isHighlight = highlightedBuilding && highlightedBuilding.username === b.username;

          return (
            <circle
              key={`mm-${b.username}`}
              cx={x}
              cy={y}
              r={isHighlight ? 3.8 : 2.2}
              fill={isHighlight ? "#22c55e" : "#38bdf8"}
              opacity={isHighlight ? 1 : 0.58}
            />
          );
        })}

        <circle cx={half + scale(helicopter.x)} cy={half + scale(helicopter.z)} r="4.2" fill="#f59e0b" />
      </svg>

      <button
        onClick={onJump}
        disabled={!highlightedBuilding}
        style={{
          marginTop: 8,
          width: "100%",
          border: "none",
          borderRadius: 8,
          padding: isMobile ? "8px 8px" : "10px 12px",
          background: highlightedBuilding ? "#22c55e" : "#334155",
          color: highlightedBuilding ? "#052e16" : "#94a3b8",
          fontWeight: 700,
          fontSize: isMobile ? 11 : 14,
          cursor: highlightedBuilding ? "pointer" : "default",
        }}
      >
        {isMobile ? "Jump Highlight" : "Jump To Highlighted User"}
      </button>
    </div>
  );
}

function StatsPanel({ fps, buildingCount, apiStatus, isMobile }) {
  if (isMobile) return null;
  const resetTime = apiStatus.resetEpoch
    ? new Date(apiStatus.resetEpoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 34,
        transform: "translateY(270px)",
        background: "rgba(2, 6, 23, 0.9)",
        border: "1px solid rgba(34, 211, 238, 0.55)",
        borderRadius: 10,
        padding: "10px 12px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#bae6fd",
        minWidth: 250,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ color: "#67e8f9", fontWeight: 700, marginBottom: 4 }}>System Stats</div>
      FPS: {fps.toFixed(0)}
      <br />
      Buildings: {buildingCount}
      <br />
      API Remaining: {apiStatus.remaining ?? "--"}/{apiStatus.limit ?? "--"}
      <br />
      Reset: {resetTime}
      <br />
      API Status: {apiStatus.message || "OK"}
    </div>
  );
}

function MobileFlightControls({
  isMobile,
  motionEnabled,
  motionSupported,
  onEnableMotion,
  onMoveChange,
  onLiftChange,
  motionMessage,
}) {
  if (!isMobile) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 14,
        bottom: 18,
        zIndex: 40,
        width: 210,
        background: "rgba(2, 6, 23, 0.88)",
        border: "1px solid rgba(34, 211, 238, 0.55)",
        borderRadius: 12,
        padding: 10,
        color: "#bae6fd",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ fontWeight: 700, color: "#67e8f9", marginBottom: 6 }}>Mobile Flight</div>
      <div style={{ marginBottom: 6 }}>
        {motionEnabled ? "Tilt steering active" : "Enable motion controls for tilt steering"}
      </div>
      <div style={{ marginBottom: 8, fontSize: 11, color: "#93c5fd", minHeight: 30 }}>
        {motionMessage}
      </div>
      {!motionEnabled ? (
        <button
          onClick={onEnableMotion}
          disabled={!motionSupported}
          style={{
            width: "100%",
            border: "none",
            borderRadius: 8,
            padding: "9px 10px",
            background: motionSupported ? "#0ea5e9" : "#334155",
            color: motionSupported ? "#001018" : "#94a3b8",
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          {motionSupported ? "Enable Tilt Controls" : "Motion Not Supported"}
        </button>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <button
          onPointerDown={() => onMoveChange(-1, 0)}
          onPointerUp={() => onMoveChange(0, 0)}
          onPointerCancel={() => onMoveChange(0, 0)}
          onPointerLeave={() => onMoveChange(0, 0)}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "9px 0",
            background: "#334155",
            color: "#dbeafe",
            fontWeight: 800,
          }}
        >
          LEFT
        </button>
        <button
          onPointerDown={() => onMoveChange(1, 0)}
          onPointerUp={() => onMoveChange(0, 0)}
          onPointerCancel={() => onMoveChange(0, 0)}
          onPointerLeave={() => onMoveChange(0, 0)}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "9px 0",
            background: "#334155",
            color: "#dbeafe",
            fontWeight: 800,
          }}
        >
          RIGHT
        </button>
        <button
          onPointerDown={() => onMoveChange(0, 1)}
          onPointerUp={() => onMoveChange(0, 0)}
          onPointerCancel={() => onMoveChange(0, 0)}
          onPointerLeave={() => onMoveChange(0, 0)}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "9px 0",
            background: "#0ea5e9",
            color: "#001018",
            fontWeight: 800,
          }}
        >
          FORWARD
        </button>
        <button
          onPointerDown={() => onMoveChange(0, -1)}
          onPointerUp={() => onMoveChange(0, 0)}
          onPointerCancel={() => onMoveChange(0, 0)}
          onPointerLeave={() => onMoveChange(0, 0)}
          style={{
            border: "none",
            borderRadius: 8,
            padding: "9px 0",
            background: "#334155",
            color: "#dbeafe",
            fontWeight: 800,
          }}
        >
          BACK
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onPointerDown={() => onLiftChange(1)}
          onPointerUp={() => onLiftChange(0)}
          onPointerCancel={() => onLiftChange(0)}
          onPointerLeave={() => onLiftChange(0)}
          style={{
            flex: 1,
            border: "none",
            borderRadius: 8,
            padding: "10px 0",
            background: "#22c55e",
            color: "#052e16",
            fontWeight: 800,
          }}
        >
          UP
        </button>
        <button
          onPointerDown={() => onLiftChange(-1)}
          onPointerUp={() => onLiftChange(0)}
          onPointerCancel={() => onLiftChange(0)}
          onPointerLeave={() => onLiftChange(0)}
          style={{
            flex: 1,
            border: "none",
            borderRadius: 8,
            padding: "10px 0",
            background: "#f59e0b",
            color: "#111827",
            fontWeight: 800,
          }}
        >
          DOWN
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState([]);
  const [focusedUser, setFocusedUser] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [addInput, setAddInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [highlightedUsername, setHighlightedUsername] = useState(null);
  const [pendingUsername, setPendingUsername] = useState("");
  const [focusPoint, setFocusPoint] = useState(null);
  const [searchStatus, setSearchStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [boom, setBoom] = useState(false);
  const [visualPreset, setVisualPreset] = useState("dystopian");
  const [searchAssist, setSearchAssist] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [motionSupported, setMotionSupported] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [motionMessage, setMotionMessage] = useState("Tilt not active yet.");
  const [apiStatus, setApiStatus] = useState({
    remaining: null,
    limit: null,
    resetEpoch: null,
    message: "Initializing",
  });
  const [telemetry, setTelemetry] = useState({ x: 0, y: 42, z: 0, speed: 0, fps: 60 });
  const [customUsers, setCustomUsers] = useState([]);

  const boomTimerRef = useRef(null);
  const assistTimerRef = useRef(null);
  const mobileInputRef = useRef({
    tiltTurn: 0,
    tiltThrust: 0,
    manualTurn: 0,
    manualThrust: 0,
    lift: 0,
  });
  const neutralOrientationRef = useRef(null);
  const orientationSeenRef = useRef(false);

  const helicopterStateRef = useRef({
    position: new THREE.Vector3(0, 42, 0),
    yaw: Math.PI,
    bank: 0,
    speed: 0,
  });

  const updateRate = useCallback((rate, statusCode) => {
    setApiStatus((prev) => ({
      remaining: rate.remaining ?? prev.remaining,
      limit: rate.limit ?? prev.limit,
      resetEpoch: rate.resetEpoch ?? prev.resetEpoch,
      message:
        statusCode >= 200 && statusCode < 300
          ? "OK"
          : statusCode === 404
            ? "Not Found"
            : `HTTP ${statusCode}`,
    }));
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadUsers() {
      setLoading(true);
      try {
        const isLikelyMobile =
          window.matchMedia?.("(pointer: coarse)")?.matches ||
          /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
        const targetUserCount = isLikelyMobile ? 28 : 60;

        const savedRaw = localStorage.getItem(CUSTOM_USERS_STORAGE_KEY);
        const savedUsernames = savedRaw ? JSON.parse(savedRaw) : [];
        const validSaved = Array.isArray(savedUsernames)
          ? savedUsernames.filter((u) => typeof u === "string" && u.trim())
          : [];

        setSearchStatus(
          isLikelyMobile
            ? "Loading optimized mobile skyline..."
            : "Loading nearby GitHub skyline..."
        );

        const defaultUserPromise = fetchGitHubUser(DEFAULT_USERNAME, updateRate);
        const savedUsersPromise = Promise.all(validSaved.map((username) => fetchGitHubUser(username, updateRate)));

        let locationUsers = [];
        let locationLabel = "";

        try {
          const coords = await getBrowserCoordinates();
          const geo = await withTimeout(reverseGeocodeCoordinates(coords.lat, coords.lng), 2500, null);
          const geoTerms =
            geo?.terms?.length > 0
              ? geo.terms
              : ["United States"];

          locationUsers = await fetchUsersByLocationTerms(geoTerms, updateRate, targetUserCount);
          locationLabel = [geo?.city, geo?.region, geo?.country].filter(Boolean).join(", ");
        } catch {
          locationUsers = await fetchUsersByLocationTerms(["United States"], updateRate, targetUserCount);
          locationLabel = "your region";
        }

        const [defaultUser, savedUsers] = await Promise.all([defaultUserPromise, savedUsersPromise]);

        const merged = dedupeUsers([
          ...locationUsers,
          defaultUser,
          ...savedUsers.filter(Boolean),
        ]);

        let transformed = transformUsersToCity(merged);

        if (defaultUser) {
          transformed = transformed.map((user) =>
            user.username.toLowerCase() === DEFAULT_USERNAME.toLowerCase() ? { ...user, x: 0, z: 0 } : user
          );
          transformed = addGlow(transformed);
        }

        if (mounted) {
          setData(transformed);
          setCustomUsers(validSaved);
          if (locationLabel) {
            setSearchStatus(`City loaded from nearby GitHub users around ${locationLabel}.`);
          }
          if (defaultUser) {
            setFocusedUser({ ...defaultUser, x: 0, z: 0 });
          }
        }
      } catch {
        if (mounted) {
          setData([]);
          setApiStatus((prev) => ({ ...prev, message: "Load failed" }));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadUsers();

    return () => {
      mounted = false;
    };
  }, [updateRate]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_USERS_STORAGE_KEY, JSON.stringify(customUsers));
  }, [customUsers]);

  useEffect(() => {
    const coarsePointer =
      window.matchMedia?.("(pointer: coarse)")?.matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    setIsMobile(Boolean(coarsePointer));
    setMotionSupported(typeof window !== "undefined" && "DeviceOrientationEvent" in window);
  }, []);

  useEffect(() => {
    return () => {
      if (boomTimerRef.current) clearTimeout(boomTimerRef.current);
      if (assistTimerRef.current) clearTimeout(assistTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!motionEnabled) return undefined;

    orientationSeenRef.current = false;
    setMotionMessage("Waiting for sensor data...");
    const noDataTimer = setTimeout(() => {
      if (!orientationSeenRef.current) {
        setMotionMessage("No motion data. Use touch controls below.");
      }
    }, 3000);

    const onOrientation = (event) => {
      const beta = typeof event.beta === "number" ? event.beta : null;
      const gamma = typeof event.gamma === "number" ? event.gamma : null;
      if (beta === null || gamma === null) return;
      orientationSeenRef.current = true;
      setMotionMessage("Tilt active. Keep phone near neutral for stable flight.");

      if (!neutralOrientationRef.current) {
        neutralOrientationRef.current = { beta, gamma };
      }

      const base = neutralOrientationRef.current;
      const dBeta = beta - base.beta;
      const dGamma = gamma - base.gamma;

      const targetTurn = clamp(dGamma / 24, -1, 1);
      const targetThrust = clamp(dBeta / 20, -1, 1);

      mobileInputRef.current.tiltTurn = THREE.MathUtils.lerp(
        mobileInputRef.current.tiltTurn,
        targetTurn,
        0.28
      );
      mobileInputRef.current.tiltThrust = THREE.MathUtils.lerp(
        mobileInputRef.current.tiltThrust,
        targetThrust,
        0.28
      );
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    return () => {
      clearTimeout(noDataTimer);
      window.removeEventListener("deviceorientation", onOrientation, true);
      mobileInputRef.current.tiltTurn = 0;
      mobileInputRef.current.tiltThrust = 0;
      neutralOrientationRef.current = null;
    };
  }, [motionEnabled]);

  const addOrFocusUser = useCallback(
    (detail, source = "add") => {
      const existing = data.find((user) => user.username.toLowerCase() === detail.username.toLowerCase());
      let target = existing || detail;

      if (!existing) {
        const index = data.length + 1;
        const angle = index * (Math.PI * (3 - Math.sqrt(5)));
        const radius = 22 + Math.sqrt(index) * 10.5;
        const added = {
          ...detail,
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
        };
        target = added;
        setData((prev) => addGlow([...prev, added]));
      }

      setCustomUsers((prev) => {
        if (prev.some((name) => name.toLowerCase() === detail.username.toLowerCase())) return prev;
        return [...prev, detail.username];
      });

      setFocusedUser(target);
      setSelectedBuilding(target);
      setHighlightedUsername(target.username.toLowerCase());
      setFocusPoint({
        x: target.x ?? 0,
        z: target.z ?? 0,
        y: 2 + (target.posts ?? 0) * 0.4,
        key: `${target.username}-${Date.now()}`,
      });

      setSearchAssist(true);
      if (assistTimerRef.current) clearTimeout(assistTimerRef.current);
      assistTimerRef.current = setTimeout(() => setSearchAssist(false), 5200);

      if (source === "search") {
        setSearchStatus(`Found @${target.username}. Tower highlighted and camera guided.`);
      } else {
        setSearchStatus(`Added @${target.username}. Tower highlighted.`);
      }
    },
    [data]
  );

  async function handleAddGithub() {
    try {
      const username = addInput.trim();
      if (!username) return;
      setSearchStatus("Adding GitHub user...");

      const detail = await fetchGitHubUser(username, updateRate);
      if (!detail) {
        setSearchStatus("User not found or GitHub API request failed.");
        return;
      }

      addOrFocusUser(detail, "add");
      setAddInput("");
    } catch {
      setSearchStatus("Add failed. Check token/rate limit and try again.");
    }
  }

  async function handleSearchBuilding() {
    const rawQuery = searchInput.trim();
    const query = rawQuery.toLowerCase();
    if (!query) return;

    const existing = data.find((user) => user.username.toLowerCase() === query);
    if (existing) {
      addOrFocusUser(existing, "search");
      setPendingUsername("");
      return;
    }

    const fetched = await fetchGitHubUser(rawQuery, updateRate);
    if (fetched) {
      addOrFocusUser(fetched, "search");
      setPendingUsername("");
      return;
    }

    setHighlightedUsername(null);
    setPendingUsername(rawQuery);
    setSearchStatus(`@${rawQuery} is not in the city. Click "Add Missing User" to add it.`);
  }

  async function handleAddMissingUser() {
    const username = pendingUsername.trim();
    if (!username) return;

    setSearchStatus(`Adding @${username}...`);
    const fetched = await fetchGitHubUser(username, updateRate);
    if (!fetched) {
      setSearchStatus(`@${username} was not found on GitHub.`);
      return;
    }

    addOrFocusUser(fetched, "add");
    setPendingUsername("");
    setSearchInput(fetched.username);
    setSearchStatus(`Added @${fetched.username}. Now search for it to highlight again if needed.`);
  }

  const buildings = useMemo(() => {
    const scored = data.map((user) => ({
      user,
      score: user.activityScore * 1.25 + user.posts * 1.8,
    }));
    const sortedScores = [...scored].sort((a, b) => b.score - a.score);
    const maxScore = sortedScores[0]?.score ?? 1;
    const byNameRank = new Map(
      sortedScores.map((entry, index) => [entry.user.username.toLowerCase(), index])
    );

    return data.map((user) => {
      const score = user.activityScore * 1.25 + user.posts * 1.8;
      const rank = byNameRank.get(user.username.toLowerCase()) ?? data.length - 1;
      const percentile = rank / Math.max(1, data.length - 1);

      let tier = "low";
      if (percentile <= 0.02) tier = "landmark";
      else if (percentile <= 0.14) tier = "core";
      else if (percentile <= 0.5) tier = "mid";

      const tierHeightMul =
        tier === "landmark" ? 2.25 : tier === "core" ? 1.46 : tier === "mid" ? 1.12 : 0.92;
      const tierWidthMul =
        tier === "landmark" ? 1.2 : tier === "core" ? 1.08 : tier === "mid" ? 1 : 0.92;

      const baseHeight = 2 + user.posts * 0.36;
      const baseWidth = 1 + Math.log(user.activityScore + 1);
      const normalizedImportance = clamp(score / Math.max(1, maxScore), 0, 1);

      return {
        ...user,
        tier,
        importance: normalizedImportance,
        height: baseHeight * tierHeightMul + normalizedImportance * 3.8,
        width: Math.max(1.1, baseWidth * tierWidthMul),
        depth: Math.max(1.05, baseWidth * tierWidthMul * 0.82),
      };
    });
  }, [data]);

  const cityRadius = useMemo(() => {
    if (buildings.length === 0) return 90;
    return (
      Math.max(
        ...buildings.map((b) => Math.sqrt(b.x * b.x + b.z * b.z) + Math.max(b.width, b.depth))
      ) + 26
    );
  }, [buildings]);

  const highlightedBuilding = useMemo(() => {
    if (!highlightedUsername) return null;
    return buildings.find((b) => b.username.toLowerCase() === highlightedUsername.toLowerCase()) || null;
  }, [buildings, highlightedUsername]);

  const downtownPoint = useMemo(() => {
    if (buildings.length === 0) return { x: 0, z: 0, y: 48 };
    const core = buildings.filter((b) => b.tier === "landmark" || b.tier === "core").slice(0, 14);
    const sample = core.length > 0 ? core : buildings.slice(0, 12);
    const sum = sample.reduce(
      (acc, b) => {
        acc.x += b.x;
        acc.z += b.z;
        acc.y += b.height;
        return acc;
      },
      { x: 0, z: 0, y: 0 }
    );
    return {
      x: sum.x / sample.length,
      z: sum.z / sample.length,
      y: sum.y / sample.length + 16,
    };
  }, [buildings]);

  const openProfile = (url) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const onCrash = () => {
    setBoom(true);
    if (boomTimerRef.current) clearTimeout(boomTimerRef.current);
    boomTimerRef.current = setTimeout(() => setBoom(false), 700);
  };

  const handleJumpToHighlighted = () => {
    if (!highlightedBuilding) return;

    setFocusPoint({
      x: highlightedBuilding.x,
      z: highlightedBuilding.z,
      y: highlightedBuilding.height,
      key: `jump-${highlightedBuilding.username}-${Date.now()}`,
    });

    setSearchAssist(true);
    if (assistTimerRef.current) clearTimeout(assistTimerRef.current);
    assistTimerRef.current = setTimeout(() => setSearchAssist(false), 4200);

    setSearchStatus(`Jumped near @${highlightedBuilding.username}.`);
  };

  const handleSelectBuilding = (building) => {
    setSelectedBuilding(building);
    setFocusPoint({
      x: building.x,
      z: building.z,
      y: building.height,
      key: `select-${building.username}-${Date.now()}`,
    });
    setSearchStatus(`Focused on @${building.username}.`);
  };

  const handleFocusDowntown = () => {
    setFocusPoint({
      x: downtownPoint.x,
      z: downtownPoint.z,
      y: downtownPoint.y,
      key: `downtown-${Date.now()}`,
    });
    setSearchStatus("Guided to downtown skyline core.");
  };

  const handleEnableMotion = async () => {
    try {
      if (!motionSupported) {
        setSearchStatus("Motion controls are not supported on this device/browser.");
        return;
      }

      const permissionApi = window.DeviceOrientationEvent?.requestPermission;
      if (typeof permissionApi === "function") {
        const result = await permissionApi();
        if (result !== "granted") {
          setSearchStatus("Motion permission denied. Tilt controls are disabled.");
          return;
        }
      }

      neutralOrientationRef.current = null;
      setMotionEnabled(true);
      setMotionMessage("Motion permission granted. Tilt to fly.");
      setSearchStatus("Tilt controls enabled. Tilt left/right to steer, forward/back to move.");
    } catch {
      setSearchStatus("Could not enable motion controls on this browser.");
    }
  };

  const handleMobileLiftChange = (value) => {
    mobileInputRef.current.lift = clamp(value, -1, 1);
  };

  const handleMobileMoveChange = (turn, thrust) => {
    mobileInputRef.current.manualTurn = clamp(turn, -1, 1);
    mobileInputRef.current.manualThrust = clamp(thrust, -1, 1);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#020617",
          color: "#67e8f9",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 22,
        }}
      >
        Loading city...
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: isMobile ? 8 : 16,
          left: isMobile ? 8 : "auto",
          right: isMobile ? 8 : 16,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 6 : 8,
          background: "rgba(2, 6, 23, 0.88)",
          border: "1px solid rgba(34, 211, 238, 0.62)",
          boxShadow: "0 10px 28px rgba(0, 0, 0, 0.45)",
          borderRadius: 10,
          padding: isMobile ? 8 : 10,
          width: isMobile ? "calc(100vw - 16px)" : "min(33vw, 320px)",
        }}
      >
        <div
          style={{
            color: "#a5f3fc",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: isMobile ? 12 : 9,
            padding: "0 2px",
            whiteSpace: "nowrap",
            fontWeight: 700,
          }}
        >
          Add GitHub:
        </div>
        <input
          value={addInput}
          onChange={(event) => setAddInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAddGithub();
          }}
          placeholder="username to add (e.g. aman12334)"
          style={{
            flex: 1,
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid #475569",
            borderRadius: 6,
            padding: isMobile ? "9px 10px" : "4px 5px",
            fontSize: isMobile ? 14 : 10,
            outline: "none",
          }}
        />
        <button
          onClick={handleAddGithub}
          style={{
            background: "#0ea5e9",
            color: "#001018",
            border: "none",
            borderRadius: 6,
            padding: isMobile ? "9px 10px" : "5px 7px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: isMobile ? 13 : 9,
            whiteSpace: "nowrap",
          }}
        >
          Add User
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          top: isMobile ? 58 : 92,
          left: isMobile ? 8 : "auto",
          right: isMobile ? 8 : 16,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 6 : 8,
          background: "rgba(2, 6, 23, 0.86)",
          border: "1px solid rgba(250, 204, 21, 0.55)",
          boxShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
          borderRadius: 10,
          padding: isMobile ? 8 : 10,
          width: isMobile ? "calc(100vw - 16px)" : "min(33vw, 320px)",
        }}
      >
        <div
          style={{
            color: "#fde68a",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: isMobile ? 12 : 9,
            padding: "0 2px",
            whiteSpace: "nowrap",
            fontWeight: 700,
          }}
        >
          Search Building:
        </div>
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSearchBuilding();
          }}
          placeholder="username to highlight"
          style={{
            flex: 1,
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid #475569",
            borderRadius: 6,
            padding: isMobile ? "9px 10px" : "4px 5px",
            fontSize: isMobile ? 14 : 10,
            outline: "none",
          }}
        />
        <button
          onClick={handleSearchBuilding}
          style={{
            background: "#f59e0b",
            color: "#111827",
            border: "none",
            borderRadius: 6,
            padding: isMobile ? "9px 10px" : "5px 7px",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: isMobile ? 13 : 9,
            whiteSpace: "nowrap",
          }}
        >
          Search + Glow
        </button>
        {pendingUsername ? (
          <button
            onClick={handleAddMissingUser}
            style={{
              background: "#22c55e",
              color: "#052e16",
              border: "none",
              borderRadius: 6,
              padding: isMobile ? "9px 10px" : "5px 7px",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: isMobile ? 13 : 9,
              whiteSpace: "nowrap",
            }}
          >
            Add Missing User
          </button>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          top: isMobile ? 108 : 168,
          left: isMobile ? 8 : "auto",
          right: isMobile ? 8 : 16,
          zIndex: 30,
          display: "flex",
          gap: 8,
          background: "rgba(2, 6, 23, 0.86)",
          border: "1px solid rgba(56, 189, 248, 0.45)",
          borderRadius: 10,
          padding: isMobile ? 8 : 10,
          width: isMobile ? "calc(100vw - 16px)" : "min(33vw, 320px)",
          alignItems: "center",
          overflowX: isMobile ? "auto" : "visible",
        }}
      >
        <div style={{ color: "#93c5fd", fontSize: isMobile ? 12 : 9, fontWeight: 700, whiteSpace: "nowrap" }}>
          Visual Preset:
        </div>
        {Object.entries(VISUAL_PRESETS).map(([key, value]) => (
          <button
            key={key}
            onClick={() => setVisualPreset(key)}
            style={{
              background: visualPreset === key ? "#0ea5e9" : "#334155",
              color: visualPreset === key ? "#001018" : "#cbd5e1",
              border: "none",
              borderRadius: 6,
              padding: isMobile ? "8px 10px" : "5px 7px",
              fontSize: isMobile ? 12 : 9,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {value.label}
          </button>
        ))}
        <button
          onClick={handleFocusDowntown}
          style={{
            background: "#22c55e",
            color: "#052e16",
            border: "none",
            borderRadius: 6,
            padding: isMobile ? "8px 10px" : "5px 7px",
            fontSize: isMobile ? 12 : 9,
            fontWeight: 700,
            cursor: "pointer",
            marginLeft: "auto",
            whiteSpace: "nowrap",
          }}
        >
          Focus Downtown
        </button>
      </div>

      {searchStatus ? (
        <div
          style={{
            position: "absolute",
            top: isMobile ? 156 : 232,
            left: isMobile ? 8 : "auto",
            right: isMobile ? 8 : 16,
            zIndex: 30,
            color: "#bae6fd",
            background: "rgba(2, 6, 23, 0.78)",
            border: "1px solid rgba(34, 211, 238, 0.45)",
            borderRadius: 8,
            padding: isMobile ? "6px 10px" : "8px 12px",
            fontSize: isMobile ? 13 : 18,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            width: isMobile ? "calc(100vw - 16px)" : "min(33vw, 320px)",
            textAlign: "center",
          }}
        >
          {searchStatus}
        </div>
      ) : null}

      <Canvas
        dpr={[0.75, 1]}
        gl={{ antialias: false, powerPreference: "low-power" }}
        camera={{ position: [0, 50, cityRadius + 58], fov: 63, near: 0.1, far: 2600 }}
      >
        <CityScene
          buildings={buildings}
          focusedUser={focusedUser}
          highlightedUsername={highlightedUsername}
          onSelectBuilding={handleSelectBuilding}
          onCrash={onCrash}
          helicopterStateRef={helicopterStateRef}
          cityRadius={cityRadius}
          focusPoint={focusPoint}
          onTelemetry={setTelemetry}
          helicopterPosition={telemetry}
          searchAssist={searchAssist}
          visual={visualPreset}
          mobileInputRef={mobileInputRef}
        />
      </Canvas>

      <MiniMap
        buildings={buildings}
        cityRadius={cityRadius}
        helicopter={telemetry}
        highlightedBuilding={highlightedBuilding}
        onJump={handleJumpToHighlighted}
        isMobile={isMobile}
      />

      <StatsPanel fps={telemetry.fps} buildingCount={buildings.length} apiStatus={apiStatus} isMobile={isMobile} />

      <MobileFlightControls
        isMobile={isMobile}
        motionEnabled={motionEnabled}
        motionSupported={motionSupported}
        onEnableMotion={handleEnableMotion}
        onMoveChange={handleMobileMoveChange}
        onLiftChange={handleMobileLiftChange}
        motionMessage={motionMessage}
      />

      {selectedBuilding ? (
        <div
          style={{
            position: "absolute",
            right: isMobile ? 8 : 14,
            left: isMobile ? 8 : "auto",
            top: isMobile ? "auto" : "50%",
            bottom: isMobile ? 188 : "auto",
            transform: isMobile ? "none" : "translateY(-50%)",
            zIndex: 32,
            width: isMobile ? "calc(100vw - 16px)" : 320,
            background: "rgba(2, 6, 23, 0.92)",
            border: "1px solid rgba(34, 211, 238, 0.55)",
            borderRadius: 10,
            padding: isMobile ? 10 : 14,
            boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
            color: "#bae6fd",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <div style={{ fontSize: isMobile ? 12 : 14, marginBottom: 8, color: "#67e8f9" }}>Building Selected</div>
          <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, marginBottom: 8 }}>
            @{selectedBuilding.username}
          </div>
          <div style={{ fontSize: isMobile ? 12 : 13, marginBottom: 2 }}>Repos: {selectedBuilding.posts ?? 0}</div>
          <div style={{ fontSize: isMobile ? 12 : 13, marginBottom: 12 }}>
            Followers: {selectedBuilding.activityScore ?? 0}
          </div>
          <div style={{ fontSize: isMobile ? 12 : 13, marginBottom: 10, color: "#cbd5e1" }}>
            Would you like to visit this profile?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() =>
                setFocusPoint({
                  x: selectedBuilding.x,
                  z: selectedBuilding.z,
                  y: selectedBuilding.height,
                  key: `panel-focus-${selectedBuilding.username}-${Date.now()}`,
                })
              }
              style={{
                background: "#0ea5e9",
                color: "#001018",
                border: "none",
                borderRadius: 6,
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 700,
                flex: 1,
              }}
            >
              Focus
            </button>
            <button
              onClick={() => openProfile(selectedBuilding.profileUrl)}
              style={{
                background: "#22c55e",
                color: "#04120a",
                border: "none",
                borderRadius: 6,
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 700,
                flex: 1,
              }}
            >
              Visit Profile
            </button>
            <button
              onClick={() => setSelectedBuilding(null)}
              style={{
                background: "#334155",
                color: "#e2e8f0",
                border: "none",
                borderRadius: 6,
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 600,
                flex: 1,
              }}
            >
              Not Now
            </button>
          </div>
        </div>
      ) : null}

      <GameHud boom={boom} isMobile={isMobile} />
    </div>
  );
}
