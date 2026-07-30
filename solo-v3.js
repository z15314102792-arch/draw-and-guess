// ##########################################################
// #               单人创作模式 v3 (Solo Mode)                #
// ##########################################################

const soloScreen=$('#solo-screen'),soloModeBtn=$('#solo-mode-btn'),soloBackBtn=$('#solo-back-btn');
const soloCanvas=$('#solo-canvas'),soloCtx=soloCanvas.getContext('2d');
const soloSizeSlider=$('#solo-size-slider'),soloSizeVal=$('#solo-size-val');
const soloOpacitySlider=$('#solo-opacity-slider'),soloOpacityVal=$('#solo-opacity-val');
const soloSmoothSlider=$('#solo-smooth-slider'),soloSmoothVal=$('#solo-smooth-val');
const soloUndoBtn=$('#solo-undo-btn'),soloRedoBtn=$('#solo-redo-btn');
const soloClearBtn=$('#solo-clear-btn'),soloSaveBtn=$('#solo-save-btn');
const soloCustomColor=$('#solo-custom-color'),soloPanBtn=$('#solo-pan-btn');
const soloZoomBadge=$('#solo-zoom-badge'),soloZoomHint=$('#solo-zoom-hint');
function el(id){return document.querySelector(id);}

let soloBrush='pen',soloColor='#000000',soloSize=3,soloOpacity=1,soloHardness=0.5;
let soloImmersed=false,soloImmersedTimeout=null,soloToolbarCollapsed=false;
let soloDrawing=false,soloLastPos=null,soloStrokes=[],soloUndoStack=[],soloPoints=[];
let soloCamX=0,soloCamY=0,soloCamZoom=1,soloTwoFinger=false;
let soloPinching=false,soloPinchStartDist=0,soloPinchStartZoom=1,soloPinchMidX=0,soloPinchMidY=0;
let soloPanning=false,soloLastPanX=0,soloLastPanY=0,soloIsPanMode=false;
let brushTipCache=null,brushTipCacheKey='';

function getBrushTip(color,size,hardness,brush){
  if(brush==='eraser'||brush==='spray'||brush==='calligraphy'||brush==='pencil'||brush==='crayon')return null;
  var key=color+'-'+size+'-'+hardness.toFixed(2)+'-'+brush;
  if(brushTipCache&&brushTipCacheKey===key)return brushTipCache;
  var s=Math.ceil(size*2)+4,c=document.createElement('canvas');c.width=s;c.height=s;
  var cx=c.getContext('2d'),outerR=s/2,innerR=outerR*(1-hardness);
  var grad=cx.createRadialGradient(s/2,s/2,innerR,s/2,s/2,outerR);
  grad.addColorStop(0,color);grad.addColorStop(1,'rgba(0,0,0,0)');
  cx.fillStyle=grad;cx.beginPath();cx.arc(s/2,s/2,outerR,0,Math.PI*2);cx.fill();
  brushTipCache=c;brushTipCacheKey=key;return c;
}
function stampBrushTip(ctx,x,y,size,tip){if(!tip)return;var s=tip.width;ctx.drawImage(tip,x-s/2,y-s/2,s,s);}

function initSoloCanvas(){
  var wrap=el('#solo-canvas-wrap'),w=wrap.clientWidth,h=wrap.clientHeight;
  var dpr=window.devicePixelRatio||1;
  soloCanvas.style.width=w+'px';soloCanvas.style.height=h+'px';
  soloCanvas.width=w*dpr;soloCanvas.height=h*dpr;
  redrawAllStrokes();
}
function redrawAllStrokes(){
  var w=parseFloat(soloCanvas.style.width),h=parseFloat(soloCanvas.style.height);
  var dpr=window.devicePixelRatio||1;
  soloCtx.setTransform(dpr,0,0,dpr,0,0);
  soloCtx.clearRect(0,0,w,h);soloCtx.fillStyle='#FFFFFF';soloCtx.fillRect(0,0,w,h);
  soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);
  for(var i=0;i<soloStrokes.length;i++)renderStroke(soloStrokes[i]);
}
function renderStroke(stroke){
  var ctx=soloCtx,pts=stroke.points;if(pts.length<2)return;
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=stroke.opacity;
  if(stroke.brush==='eraser'){
    ctx.globalCompositeOperation='destination-out';ctx.lineWidth=stroke.size*2;ctx.strokeStyle='rgba(0,0,0,1)';
    for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
    ctx.restore();return;
  }
  ctx.globalCompositeOperation=(stroke.brush==='marker'||stroke.brush==='crayon')?'multiply':'source-over';
  if(stroke.brush==='glow'){ctx.shadowBlur=stroke.size*2;ctx.shadowColor=stroke.color;}
  var hardness=stroke.hardness!==undefined?stroke.hardness:0.5;
  var tip=(stroke.brush==='pen'||stroke.brush==='marker'||stroke.brush==='glow')?getBrushTip(stroke.color,stroke.size,hardness,stroke.brush):null;
  if(stroke.brush==='spray'){for(var i=0;i<pts.length;i++){var p=pts[i],n=Math.floor(stroke.size*2);for(var j=0;j<n;j++){var a=Math.random()*Math.PI*2,d=Math.random()*stroke.size*2;ctx.globalAlpha=stroke.opacity*Math.random()*0.25;ctx.fillStyle=stroke.color;ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,0.5+Math.random(),0,Math.PI*2);ctx.fill();}}ctx.restore();return;}
  if(stroke.brush==='water'){for(var l=0;l<3;l++){ctx.globalAlpha=stroke.opacity*0.12;ctx.lineWidth=stroke.size+l*stroke.size*0.8;ctx.strokeStyle=stroke.color;for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}ctx.restore();return;}
  if(stroke.brush==='pencil'){ctx.lineWidth=stroke.size*0.7;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.85;for(var i=1;i<pts.length;i++){var wb=stroke.size*0.15;ctx.beginPath();ctx.moveTo(pts[i-1].x+(Math.random()-0.5)*wb,pts[i-1].y+(Math.random()-0.5)*wb);ctx.lineTo(pts[i].x+(Math.random()-0.5)*wb,pts[i].y+(Math.random()-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='crayon'){ctx.lineWidth=stroke.size*1.2;ctx.strokeStyle=stroke.color;ctx.globalAlpha=stroke.opacity*0.7;for(var p=0;p<2;p++)for(var i=1;i<pts.length;i++){var wb=stroke.size*0.3;ctx.beginPath();ctx.moveTo(pts[i-1].x+(Math.random()-0.5)*wb,pts[i-1].y+(Math.random()-0.5)*wb);ctx.lineTo(pts[i].x+(Math.random()-0.5)*wb,pts[i].y+(Math.random()-0.5)*wb);ctx.stroke();}ctx.restore();return;}
  if(stroke.brush==='calligraphy'){for(var i=1;i<pts.length;i++){var p0=pts[i-1],p1=pts[i],dx=p1.x-p0.x,dy=p1.y-p0.y,speed=Math.sqrt(dx*dx+dy*dy),w=stroke.size*(1+1/(1+speed*0.3)),h=stroke.size*(1/(1+speed*0.1));ctx.save();ctx.translate(p0.x,p0.y);ctx.rotate(Math.atan2(dy,dx));ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.fillStyle=stroke.color;ctx.fill();ctx.restore();}ctx.restore();return;}
  ctx.lineWidth=stroke.size;ctx.strokeStyle=stroke.color;
  if(tip){for(var i=0;i<pts.length;i++)stampBrushTip(ctx,pts[i].x,pts[i].y,stroke.size,tip);for(var i=1;i<pts.length;i++){var dx=pts[i].x-pts[i-1].x,dy=pts[i].y-pts[i-1].y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=1;s<Math.ceil(dist/(stroke.size*0.3));s++){var t=s/Math.ceil(dist/(stroke.size*0.3));stampBrushTip(ctx,pts[i-1].x+dx*t,pts[i-1].y+dy*t,stroke.size,tip);}}}
  else{for(var i=1;i<pts.length;i++){ctx.beginPath();ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}}
  ctx.restore();
}
function getSoloPos(e){var rect=soloCanvas.getBoundingClientRect(),cx=e.touches?e.touches[0].clientX:e.clientX,cy=e.touches?e.touches[0].clientY:e.clientY,sx=cx-rect.left,sy=cy-rect.top;return{x:(sx-soloCamX)/soloCamZoom,y:(sy-soloCamY)/soloCamZoom,rawX:sx,rawY:sy};}
function getTwoFingerMid(e){var r=soloCanvas.getBoundingClientRect(),x1=e.touches[0].clientX-r.left,y1=e.touches[0].clientY-r.top,x2=e.touches[1].clientX-r.left,y2=e.touches[1].clientY-r.top;return{x:(x1+x2)/2,y:(y1+y2)/2,dist:Math.hypot(x2-x1,y2-y1)};}
function soloStart(e){if(soloTwoFinger||soloPinching)return;if(soloIsPanMode){soloPanning=true;var p=getSoloPos(e);soloLastPanX=p.rawX;soloLastPanY=p.rawY;return;}e.preventDefault();soloDrawing=true;soloLastPos=getSoloPos(e);soloPoints=[soloLastPos];}
function soloMove(e){if(soloPinching)return soloPinchMove(e);if(soloPanning){e.preventDefault();var p=getSoloPos(e);soloCamX+=p.rawX-soloLastPanX;soloCamY+=p.rawY-soloLastPanY;soloLastPanX=p.rawX;soloLastPanY=p.rawY;redrawAllStrokes();return;}if(!soloDrawing)return;e.preventDefault();var pt=getSoloPos(e);if(Math.abs(pt.x-soloLastPos.x)<0.5&&Math.abs(pt.y-soloLastPos.y)<0.5)return;soloPoints.push(pt);soloCtx.setTransform(1,0,0,1,0,0);soloCtx.scale(window.devicePixelRatio||1,window.devicePixelRatio||1);soloCtx.translate(soloCamX,soloCamY);soloCtx.scale(soloCamZoom,soloCamZoom);drawLiveSegment(soloLastPos,pt);soloLastPos=pt;}
function soloEnd(e){if(soloPinching){soloPinching=false;soloTwoFinger=e.touches?e.touches.length>=2:false;setTimeout(function(){soloZoomHint.classList.add('hidden');},1500);return;}if(soloPanning){soloPanning=false;return;}if(!soloDrawing)return;e.preventDefault();soloDrawing=false;if(soloPoints.length>=1){var pts=soloPoints.length>1?soloPoints.slice():[soloPoints[0],Object.assign({},soloPoints[0])];soloUndoStack=[];soloStrokes.push({brush:soloBrush,color:soloColor,size:soloSize,opacity:soloOpacity,hardness:soloHardness,points:pts});updateUndoRedoBtns();}soloPoints=[];}
function drawLiveSegment(from,to){var ctx=soloCtx;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=soloOpacity;if(soloBrush==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.lineWidth=soloSize*2;ctx.strokeStyle='rgba(0,0,0,1)';ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}if(soloBrush==='glow'){ctx.shadowBlur=soloSize*2;ctx.shadowColor=soloColor;}ctx.globalCompositeOperation=(soloBrush==='marker'||soloBrush==='crayon')?'multiply':'source-over';if(soloBrush==='spray'||soloBrush==='water'||soloBrush==='pencil'||soloBrush==='crayon'||soloBrush==='calligraphy'){ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();return;}var tip=(soloBrush==='pen'||soloBrush==='marker'||soloBrush==='glow')?getBrushTip(soloColor,soloSize,soloHardness,soloBrush):null;if(tip){stampBrushTip(ctx,to.x,to.y,soloSize,tip);var dx=to.x-from.x,dy=to.y-from.y,dist=Math.sqrt(dx*dx+dy*dy);for(var s=0;s<Math.ceil(dist/(soloSize*0.3));s++){var t=s/Math.ceil(dist/(soloSize*0.3));stampBrushTip(ctx,from.x+dx*t,from.y+dy*t,soloSize,tip);}}else{ctx.lineWidth=soloSize;ctx.strokeStyle=soloColor;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}ctx.restore();}
function soloPinchMove(e){var m=getTwoFingerMid(e),nz=soloPinchStartZoom*(m.dist/soloPinchStartDist);soloCamZoom=Math.max(0.01,Math.min(5,nz));var r=soloCamZoom/soloPinchStartZoom;soloCamX=m.x-(soloPinchMidX-soloCamX)*r;soloCamY=m.y-(soloPinchMidY-soloCamY)*r;soloPinchMidX=m.x;soloPinchMidY=m.y;soloPinchStartZoom=soloCamZoom;soloPinchStartDist=m.dist;redrawAllStrokes();updateZoomBadge();}

// event bindings
soloCanvas.addEventListener('touchstart',function(e){if(e.touches.length===2){e.preventDefault();soloPinching=true;soloTwoFinger=true;soloDrawing=false;var m=getTwoFingerMid(e);soloPinchStartDist=m.dist;soloPinchStartZoom=soloCamZoom;soloPinchMidX=m.x;soloPinchMidY=m.y;soloZoomHint.classList.remove('hidden');}else if(e.touches.length===1&&!soloPinching){soloTwoFinger=false;soloStart(e);}},{passive:false});
soloCanvas.addEventListener('touchmove',function(e){if(e.touches.length===2&&soloPinching){e.preventDefault();soloPinchMove(e);}else if(soloPanning)soloMove(e);else if(!soloPinching)soloMove(e);},{passive:false});
soloCanvas.addEventListener('touchend',soloEnd);
soloCanvas.addEventListener('mousedown',soloStart);soloCanvas.addEventListener('mousemove',soloMove);
soloCanvas.addEventListener('mouseup',soloEnd);soloCanvas.addEventListener('mouseleave',function(e){if(soloDrawing)soloEnd(e);});
soloCanvas.addEventListener('wheel',function(e){e.preventDefault();var rect=soloCanvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top,nz=Math.max(0.01,Math.min(5,soloCamZoom*(e.deltaY<0?1.1:0.9)));soloCamX=mx-(mx-soloCamX)*(nz/soloCamZoom);soloCamY=my-(my-soloCamY)*(nz/soloCamZoom);soloCamZoom=nz;redrawAllStrokes();updateZoomBadge();},{passive:false});
function updateZoomBadge(){soloZoomBadge.textContent=Math.round(soloCamZoom*100)+'%';}

// brush selector
el('#solo-brushes').addEventListener('click',function(e){var btn=e.target.closest('.solo-brush-btn');if(!btn)return;el('#solo-brushes').querySelectorAll('.solo-brush-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloBrush=btn.dataset.brush;});
soloPanBtn.addEventListener('click',function(){soloIsPanMode=!soloIsPanMode;soloPanBtn.classList.toggle('active',soloIsPanMode);soloCanvas.style.cursor=soloIsPanMode?'grab':'crosshair';});
soloSizeSlider.addEventListener('input',function(){soloSize=+soloSizeSlider.value;soloSizeVal.textContent=soloSize;});
soloOpacitySlider.addEventListener('input',function(){soloOpacity=+soloOpacitySlider.value/100;soloOpacityVal.textContent=soloOpacitySlider.value;});
soloSmoothSlider.addEventListener('input',function(){soloHardness=1-+soloSmoothSlider.value/100;soloSmoothVal.textContent=soloSmoothSlider.value;brushTipCache=null;});
el('#solo-colors-wrap').addEventListener('click',function(e){var btn=e.target.closest('.solo-color-btn');if(!btn)return;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');soloColor=btn.dataset.color;soloCustomColor.value=soloColor;brushTipCache=null;});
soloCustomColor.addEventListener('input',function(){soloColor=soloCustomColor.value;document.querySelectorAll('.solo-color-btn').forEach(function(b){b.classList.remove('active');});brushTipCache=null;});
soloUndoBtn.addEventListener('click',function(){if(!soloStrokes.length)return;soloUndoStack.push(soloStrokes.pop());redrawAllStrokes();updateUndoRedoBtns();});
soloRedoBtn.addEventListener('click',function(){if(!soloUndoStack.length)return;soloStrokes.push(soloUndoStack.pop());redrawAllStrokes();updateUndoRedoBtns();});
soloClearBtn.addEventListener('click',function(){if(!soloStrokes.length)return;if(confirm('确定清空画布吗？')){soloStrokes=[];soloUndoStack=[];redrawAllStrokes();updateUndoRedoBtns();}});
soloSaveBtn.addEventListener('click',function(){var a=document.createElement('a');a.download='画作_'+new Date().toISOString().slice(0,10)+'.png';a.href=soloCanvas.toDataURL('image/png');a.click();showToast('已保存');});
function updateUndoRedoBtns(){soloUndoBtn.disabled=!soloStrokes.length;soloRedoBtn.disabled=!soloUndoStack.length;}

// collapse toolbar
el('#solo-toggle-toolbar').addEventListener('click',function(){soloToolbarCollapsed=!soloToolbarCollapsed;var tb=el('#solo-toolbar');tb.classList.toggle('collapsed',soloToolbarCollapsed);el('#solo-toggle-toolbar').textContent=soloToolbarCollapsed?'▲':'▼';});

// immersive mode
el('#solo-immerse-btn').addEventListener('click',function(){soloImmersed=true;el('#solo-top-bar').classList.add('immersed');el('#solo-toolbar').classList.add('immersed');el('#solo-exit-immerse').classList.remove('hidden');});
el('#solo-exit-immerse').addEventListener('click',function(){soloImmersed=false;el('#solo-top-bar').classList.remove('immersed');el('#solo-toolbar').classList.remove('immersed');el('#solo-exit-immerse').classList.add('hidden');});
soloCanvas.addEventListener('click',function(e){if(!soloImmersed)return;el('#solo-top-bar').classList.remove('immersed');el('#solo-toolbar').classList.remove('immersed');el('#solo-exit-immerse').classList.remove('hidden');clearTimeout(soloImmersedTimeout);soloImmersedTimeout=setTimeout(function(){if(soloImmersed){el('#solo-top-bar').classList.add('immersed');el('#solo-toolbar').classList.add('immersed');}},2000);});

// entry/exit
soloModeBtn.addEventListener('click',function(){lobbyScreen.classList.remove('active');soloScreen.classList.add('active');soloStrokes=[];soloUndoStack=[];soloCamX=0;soloCamY=0;soloCamZoom=1;soloImmersed=false;soloToolbarCollapsed=false;el('#solo-top-bar').classList.remove('immersed');el('#solo-toolbar').classList.remove('immersed','collapsed');el('#solo-exit-immerse').classList.add('hidden');el('#solo-toggle-toolbar').textContent='▼';initSoloCanvas();updateUndoRedoBtns();updateZoomBadge();});
soloBackBtn.addEventListener('click',function(){soloScreen.classList.remove('active');lobbyScreen.classList.add('active');soloIsPanMode=false;soloPanBtn.classList.remove('active');});
window.addEventListener('resize',function(){if(soloScreen.classList.contains('active'))initSoloCanvas();});
window.addEventListener('orientationchange',function(){if(soloScreen.classList.contains('active'))setTimeout(initSoloCanvas,300);});
