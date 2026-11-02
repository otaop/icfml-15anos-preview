import { buildCurlMesh } from "./page-curl.mjs?v=20261029-curl8";
import { createCanvasPaperSurface } from "./paper-canvas.mjs?v=20261029-curl8";
import { buildPaperShadow } from "./paper-shadow.mjs?v=20261029-curl8";
import { PAPER_LIGHTING_GLSL } from "./paper-lighting.mjs?v=20261029-curl8";

// Independent developable corner fold, rendered orthographically for direct pointer tracking.
const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform vec2 uViewport;
uniform vec4 uPage;
uniform mediump float uShadow;
uniform mediump vec3 uBend;
varying mediump vec2 vUv;
varying mediump vec3 vNormal;
varying mediump float vLift;
void main() {
  vUv = aUv;
  vNormal = aNormal;
  vLift = aPosition.z;
  vec3 point = vec3(uPage.x + aPosition.x*uPage.z, uPage.y + aPosition.y*uPage.w, aPosition.z*uPage.z);
  if (uShadow > .5) {
    // The low, front-facing half of the bend receives contact shadow too.
    // The upper return of the leaf stays above this depth and occludes it.
    gl_Position = vec4(aPosition.x/uViewport.x*2.-1., 1.-aPosition.y/uViewport.y*2., -uBend.z/3., 1.);
  } else {
    gl_Position = vec4(point.x/uViewport.x*2.-1., 1.-point.y/uViewport.y*2., -aPosition.z/3., 1.);
  }
}`;
const FRAGMENT = `
precision mediump float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uDirection;
uniform float uProgress;
uniform mediump float uShadow;
uniform vec4 uFold;
uniform mediump vec3 uBend;
varying mediump vec2 vUv;
varying mediump vec3 vNormal;
varying mediump float vLift;
${PAPER_LIGHTING_GLSL}
void main() {
  if (uShadow > .5) {
    gl_FragColor = vec4(.055,.09,.12,vNormal.x);
  } else {
    bool front = gl_FrontFacing == (uDirection > 0.);
    vec2 uv = vec2(front ? (uDirection > 0. ? vUv.x : 1.-vUv.x) : (uDirection > 0. ? 1.-vUv.x : vUv.x),vUv.y);
    vec4 color;
    if (front) color = texture2D(uFront,uv);
    else color = texture2D(uBack,uv);
    float distance = dot(vec2(vUv.x,vUv.y*uBend.x)-uFold.xy,uFold.zw);
    float shade = paperShade(vNormal,front,distance,uBend.y,uBend.z);
    gl_FragColor = vec4(color.rgb*shade,color.a);
  }
}`;

function shader(gl, type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(detail || "Paper shader unavailable");
  }
  return result;
}

function webglSurface(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) { canvas.dataset.gpuStatus = "unavailable"; return null; }
  let program;
  try {
    const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (error) {
    canvas.dataset.gpuStatus = "shader-unavailable";
    canvas.dataset.gpuError = error.message.slice(0, 350);
    if (program) gl.deleteProgram(program);
    return null;
  }
  canvas.dataset.gpuStatus = "ready";
  const attributes = Object.fromEntries(["aPosition","aNormal","aUv"].map((key) => [key,gl.getAttribLocation(program,key)]));
  const uniforms = Object.fromEntries(["uViewport","uPage","uShadow","uDirection","uProgress","uFront","uBack","uFold","uBend"].map((key) => [key,gl.getUniformLocation(program,key)]));
  const buffers = Object.fromEntries(["position","normal","uv","index","shadowPosition","shadowNormal","shadowUv","shadowIndex"].map((key) => [key,gl.createBuffer()]));
  let usable = true;
  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); usable = false; });
  function texture(source, unit) {
    const result = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, result);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    return result;
  }
  return {
    get usable() { return usable; },
    prepare(front, back, scene, initial) {
      const scale = Math.min(globalThis.devicePixelRatio || 1, 2, 4096 / Math.max(scene.width,scene.height), Math.sqrt(8_000_000/(scene.width*scene.height)));
      canvas.width = Math.max(1,Math.round(scene.width*scale));
      canvas.height = Math.max(1,Math.round(scene.height*scale));
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.useProgram(program);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      const textures = [texture(front,0),texture(back,1)];
      gl.uniform1i(uniforms.uFront,0); gl.uniform1i(uniforms.uBack,1);
      gl.uniform2f(uniforms.uViewport,scene.width,scene.height);
      gl.uniform4f(uniforms.uPage,scene.spine,scene.y,scene.pageWidth,scene.pageHeight);
      gl.uniform1f(uniforms.uDirection,scene.direction);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,initial.indices,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers.uv);
      gl.bufferData(gl.ARRAY_BUFFER,initial.uvs,gl.STATIC_DRAW);
      gl.enableVertexAttribArray(attributes.aUv);
      gl.vertexAttribPointer(attributes.aUv,2,gl.FLOAT,false,0,0);
      let disposed = false;
      return {
        draw(mesh, progress) {
          if (!usable || disposed) return;
          gl.useProgram(program);
          gl.disable(gl.SCISSOR_TEST);
          gl.depthMask(true);
          gl.clearColor(0,0,0,0); gl.clearDepth(1);
          gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
          for (const [buffer,attribute,data] of [[buffers.position,attributes.aPosition,mesh.positions],[buffers.normal,attributes.aNormal,mesh.normals]]) {
            gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
            gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(attribute);
            gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
          }
          gl.bindBuffer(gl.ARRAY_BUFFER,buffers.uv);
          gl.bufferData(gl.ARRAY_BUFFER,mesh.uvs,gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(attributes.aUv,2,gl.FLOAT,false,0,0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers.index);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.DYNAMIC_DRAW);
          if (scene.mode === "single") {
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(Math.round(scene.x*scale),Math.round((scene.height-scene.y-scene.pageHeight)*scale),Math.round(scene.pageWidth*scale),Math.round(scene.pageHeight*scale));
          }
          const pose = mesh.pose;
          gl.uniform4f(uniforms.uFold,pose.M.x,pose.M.y,pose.n.x,pose.n.y);
          gl.uniform3f(uniforms.uBend,pose.aspect,pose.halfWidth,pose.radius);
          gl.uniform1f(uniforms.uProgress,progress);
          gl.uniform1f(uniforms.uShadow,0);
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
          gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);
          // Draw AFTER the leaf, through the low half of the curved strip.
          // Its upper return occludes the shadow; the front contact arc and
          // the flat page both receive it, without an unshaded crescent.
          const shadow = buildPaperShadow(mesh,scene);
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(Math.round(scene.x*scale),Math.round((scene.height-scene.y-scene.pageHeight)*scale),Math.round(scene.pageWidth*(scene.mode==="double"?2:1)*scale),Math.round(scene.pageHeight*scale));
          if (shadow.indices.length) {
            for (const [buffer,attribute,data,size] of [[buffers.shadowPosition,attributes.aPosition,shadow.positions,3],[buffers.shadowNormal,attributes.aNormal,shadow.normals,3],[buffers.shadowUv,attributes.aUv,new Float32Array(shadow.positions.length/3*2),2]]) {
              gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
              gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
              gl.enableVertexAttribArray(attribute);
              gl.vertexAttribPointer(attribute,size,gl.FLOAT,false,0,0);
            }
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers.shadowIndex);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,shadow.indices,gl.DYNAMIC_DRAW);
            gl.uniform1f(uniforms.uShadow,1);
            gl.depthMask(false);
            gl.drawElements(gl.TRIANGLES,shadow.indices.length,gl.UNSIGNED_SHORT,0);
          }
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const item of textures) gl.deleteTexture(item);
          // Keep the last opaque frame intact until the hidden canvas is reused.
          // Clearing here can expose the destination before its DOM handoff.
        },
      };
    },
  };
}

export function createPageTurnRenderer(stage) {
  const canvas = document.createElement("canvas");
  const fallback = document.createElement("canvas");
  for (const surface of [canvas,fallback]) {
    surface.className = "reader-turn-canvas";
    surface.setAttribute("aria-hidden","true");
    surface.hidden = true;
    stage.append(surface);
  }
  let gpu;
  let attempted = false;
  let active;
  function begin({ front,back,geometry,direction,host,reducedMotion=false,corner="bottom",gripY=corner==="top"?0:1,onComplete }, automaticDuration) {
    active?.finish();
    const stageBox = stage.getBoundingClientRect();
    const bookBox = host.getBoundingClientRect();
    const scene = {
      width:stage.clientWidth,height:stage.clientHeight,
      pageWidth:geometry.pageWidth,pageHeight:geometry.pageHeight,
      x:bookBox.left-stageBox.left, y:bookBox.top-stageBox.top,
      spine:bookBox.left-stageBox.left+(geometry.mode==="double"||direction<0?geometry.pageWidth:0),
      mode:geometry.mode,direction,
    };
    const aspect = geometry.pageHeight/geometry.pageWidth;
    const automatic = automaticDuration !== undefined;
    let progress = 0;
    let vertical = 0;
    let grip = Math.max(0,Math.min(1,gripY));
    let surface;
    let engine = "reduced-motion";
    const meshOptions = {direction,corner,aspect,mode:geometry.mode,gripY:grip};
    if (!reducedMotion) {
      // A portrait viewport advances one PDF page. Its destination belongs on
      // the base only; repeating it on the turning reverse looks like an open
      // spread and exposes the next page twice before the turn is complete.
      let reverse = back;
      if (geometry.mode === "single") {
        reverse = document.createElement("canvas");
        reverse.width = reverse.height = 2;
        const paper = reverse.getContext("2d", { alpha: false });
        if (!paper) throw new Error("Paper reverse is unavailable.");
        paper.fillStyle = "#fbf9f5";
        paper.fillRect(0,0,2,2);
      }
      if (!attempted) { gpu=webglSurface(canvas); attempted=true; }
      if (gpu?.usable) {
        try { surface=gpu.prepare(front,reverse,scene,buildCurlMesh(0,meshOptions)); engine="webgl"; }
        catch { /* The same corner fold is available through Canvas2D. */ }
      }
      if (!surface) { surface=createCanvasPaperSurface(fallback,front,reverse,scene); engine="canvas2d"; }
    }
    canvas.hidden = true;
    fallback.hidden = true;
    stage.dataset.turnEngine = engine;
    stage.dataset.turnModel = "corner-curl-v8";
    stage.dataset.turnState = "dragging";
    let resolve;
    let frame;
    let revision=0;
    let done=false;
    let maxWork=0;
    const finished = new Promise((complete)=>{resolve=complete;});
    function stopFrame() {
      revision+=1;
      if(frame!==undefined) cancelAnimationFrame(frame);
      frame=undefined;
    }
    function draw(value, lift=vertical) {
      const started=performance.now();
      progress=Math.max(0,Math.min(1,value));
      vertical=lift;
      stage.dataset.turnProgress=String(progress);
      stage.dataset.turnVertical=String(vertical);
      stage.dataset.turnCorner=corner;
      stage.dataset.turnGripY=String(grip);
      stage.dataset.turnPhase=progress<.3?"lift":progress<.7?"curl":"settle";
      if(surface) {
        const bend=automatic ? (corner==="top"?1:-1)*aspect*.18*Math.sin(Math.PI*progress) : vertical;
        const mesh=buildCurlMesh(progress,{...meshOptions,gripY:grip,vertical:bend,segments:engine==="canvas2d"?18:32});
        surface.draw(mesh,progress);
      }
      maxWork=Math.max(maxWork,performance.now()-started);
      stage.dataset.turnMaxWorkMs=maxWork.toFixed(2);
    }
    function complete(committed) {
      if(done) return finished;
      done=true; stopFrame();
      draw(committed?1:0,0);
      // The owner installs the final static pages while the opaque endpoint is
      // still presented. Promise callbacks run too late for this layer handoff.
      onComplete?.({committed});
      canvas.hidden=true; fallback.hidden=true;
      surface?.dispose();
      stage.dataset.turnState="idle"; stage.dataset.turnPhase="idle";
      if(active===controller) active=undefined;
      resolve({committed});
      return finished;
    }
    function update(value) {
      if(done) return;
      const numeric=typeof value==="object"?Number(value.progress):Number(value);
      const nextVertical=typeof value==="object"?Number(value.vertical??vertical):vertical;
      const nextGrip=typeof value==="object"?Number(value.gripY??grip):grip;
      if(!Number.isFinite(numeric)||!Number.isFinite(nextVertical)||!Number.isFinite(nextGrip)) return;
      stopFrame();
      grip=Math.max(0,Math.min(1,nextGrip));
      stage.dataset.turnState="dragging";
      draw(numeric,nextVertical);
    }
    function settle(committed,{velocity=0}={}) {
      if(done) return finished;
      stopFrame();
      const target=committed?1:0;
      const from=progress;
      const fromVertical=vertical;
      const distance=Math.abs(target-from);
      if(reducedMotion||distance<1e-6) return complete(Boolean(committed));
      const duration=automaticDuration??Math.max(220,Math.min(560,240+distance*300));
      const seconds=duration/1000;
      // Monotone cubic Hermite: preserve release velocity, then come to rest.
      const signed=Number.isFinite(velocity)?velocity:0;
      const tangent=automatic?0:Math.sign(target-from)*Math.min(Math.max(0,signed*Math.sign(target-from))*seconds,3*distance);
      stage.dataset.turnState="settling";
      const token=revision;
      const started=performance.now();
      function tick(now) {
        if(done||token!==revision) return;
        frame=undefined;
        const t=Math.max(0,Math.min(1,(now-started)/duration));
        const t2=t*t, t3=t2*t;
        const value=(2*t3-3*t2+1)*from+(t3-2*t2+t)*tangent+(-2*t3+3*t2)*target;
        draw(value,fromVertical*(1-(3*t2-2*t3)));
        if(t>=1) complete(Boolean(committed));
        else frame=requestAnimationFrame(tick);
      }
      frame=requestAnimationFrame(tick);
      return finished;
    }
    const controller={finished,update,settle,finish(){return complete(true);},cancel(){return complete(false);},get progress(){return progress;},get vertical(){return vertical;},get gripY(){return grip;}};
    active=controller;
    draw(0);
    canvas.hidden=engine!=="webgl";
    fallback.hidden=engine!=="canvas2d";
    return controller;
  }
  return {
    begin,
    animate(options) {
      const controller=begin(options,options.geometry.mode==="double"?850:740);
      if(!options.deferStart) controller.settle(true);
      return controller;
    },
  };
}
