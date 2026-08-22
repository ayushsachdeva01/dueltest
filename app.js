/* DuelTest v2 — production-oriented client state machine. */
const cfg = window.DUEL_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('PASTE_') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PASTE_');
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const state = {
  me:null,lobby:null,test:null,mine:null,players:[],
  lobbyChannel:null,battleChannel:null,timer:null,
  battleEntered:false,finishSubmitted:false,keyShown:false,resultsShown:false,
  pdfDocs:[],pages:[],visiblePages:[],pageIndex:0,zoom:1.12,currentQ:1,selected:null,answers:{},answerBusy:false,answerFeedbackTimer:null,
  editorId:null,editorExistingFiles:[],editorPdfDocs:[],editorPdfPages:[],editorPageIndex:0,partialRules:{},partialDrag:false
};

function show(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$(id).classList.add('active');window.scrollTo(0,0)}
function modal(title,body,actions='<button class="primary-btn full" id="modalOk">OK</button>'){
  $('modalContent').innerHTML=`<h3>${esc(title)}</h3><div class="modal-body">${body}</div>${actions}`;$('modal').classList.remove('hidden');
  $('modalOk')?.addEventListener('click',()=>closeModal());
}
function closeModal(){$('modal').classList.add('hidden')}
$('modalClose').onclick=closeModal;
function requireConfig(){if(!configured){modal('Supabase setup required','Open <b>config.js</b> and paste your Project URL and browser-safe Publishable/Anon key.');return false}return true}
function setStatus(t,ok=false){$('connectionStatus').textContent=t;document.querySelector('.status-dot').style.background=ok?'var(--green)':'var(--amber)'}
function setMessage(t){$('adminMessage').textContent=t||''}

async function init(){
  if(!sb){setStatus('Setup required');showAuth();return}
  try{
    const {data:sessionData}=await sb.auth.getSession();
    if(sessionData.session){
      state.me=sessionData.session.user;
      const ok=await loadCurrentProfile();
      if(ok) enterApp(); else {await sb.auth.signOut();showAuth();}
    }else showAuth();
  }catch(e){console.error(e);setStatus('Backend connection failed');showAuth();setAuthMessage(e.message||String(e))}
}
init();


function normalizeUsername(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9_.-]/g,'')}
function authEmail(username){return `${normalizeUsername(username)}@dueltest.local`}
function setAuthMessage(t,ok=false){const el=$('authMessage');if(el){el.textContent=t||'';el.style.color=ok?'var(--green)':'var(--danger)'}}
function showAuth(){
  // Remove the application completely before showing authentication.
  $('appHeader').classList.add('hidden');
  $('appMain').classList.add('hidden');
  document.querySelectorAll('#appMain .view').forEach(v=>v.classList.remove('active'));

  $('authView').classList.remove('hidden');
  $('authView').classList.add('active');
  window.scrollTo(0,0);
  checkBootstrapState();
}
async function checkBootstrapState(){
  if(!sb)return;
  try{const {data,error}=await sb.rpc('bootstrap_status');if(error)throw error;const needs=!!data?.needs_bootstrap;$('loginForm').classList.toggle('hidden',needs);$('bootstrapForm').classList.toggle('hidden',!needs);$('authTitle').textContent=needs?'Create your superuser':'Sign in';$('authSubtitle').textContent=needs?'First setup only. Your username is Carneceria. Choose the password you will use from now on.':'Sign in with the account created by the superuser.';setAuthMessage(needs?'No superuser exists yet. Set your password to finish setup.':'')}catch(e){setAuthMessage(e.message||String(e))}
}
async function bootstrapSuperuser(password){
  const {data:createdId,error}=await sb.rpc('bootstrap_superuser',{p_password:password});
  if(error)throw error;
  if(!createdId)throw new Error('Superuser creation returned no user ID.');

  // The RPC creates the auth.users row, but it cannot create a browser session.
  // Explicitly sign in here and surface the real Supabase auth error if it fails.
  const {data,error:loginError}=await sb.auth.signInWithPassword({
    email:authEmail('Carneceria'),
    password
  });
  if(loginError)throw new Error(`Superuser was created, but automatic sign-in failed: ${loginError.message}`);
  if(!data?.user)throw new Error('Superuser was created, but Supabase returned no authenticated user.');
  return data.user;
}
async function loadCurrentProfile(){
  const {data,error}=await sb.from('profiles').select('id,username,display_name,role,created_at').eq('id',state.me.id).maybeSingle();
  if(error){console.error(error);return false}
  if(!data || data.disabled)return false;
  state.profile=data;state.role=data.role;
  return true;
}
function enterApp(){
  // Auth and application are mutually exclusive roots.
  // Hide the entire auth view so it cannot remain in document flow.
  $('authView').classList.remove('active');
  $('authView').classList.add('hidden');
  $('appHeader').classList.remove('hidden');
  $('appMain').classList.remove('hidden');
  show('homeView');
  $('headerUsername').textContent=state.profile.display_name||state.profile.username;$('headerAvatar').textContent=(state.profile.display_name||state.profile.username).slice(0,1).toUpperCase();
  document.querySelectorAll('.superuser-only').forEach(el=>el.classList.toggle('hidden',state.profile.role!=='superuser'));
  setStatus('Signed in',true);loadTests();loadHistory();loadActiveBattles();
}
async function signIn(){
  const username=normalizeUsername($('loginUsername').value),password=$('loginPassword').value;
  if(!username||!password)return setAuthMessage('Enter username and password.');
  $('loginBtn').disabled=true;setAuthMessage('Signing in…');
  const {data,error}=await sb.auth.signInWithPassword({email:authEmail(username),password});
  if(error){$('loginBtn').disabled=false;return setAuthMessage(error.message)}
  state.me=data.user;if(!(await loadCurrentProfile())){await sb.auth.signOut();$('loginBtn').disabled=false;return setAuthMessage('This account has no DuelTest profile. Ask the superuser to recreate it.')}
  $('loginBtn').disabled=false;enterApp();
}
$('loginForm').onsubmit=e=>{e.preventDefault();signIn()};
$('bootstrapForm').onsubmit=async e=>{e.preventDefault();const p=$('bootstrapPassword').value,p2=$('bootstrapPassword2').value;if(p.length<8)return setAuthMessage('Password must be at least 8 characters.');if(p!==p2)return setAuthMessage('Passwords do not match.');try{$('bootstrapForm').querySelector('button').disabled=true;state.me=await bootstrapSuperuser(p);if(!(await loadCurrentProfile()))throw new Error('Superuser was created, but its profile could not be loaded. Refresh and sign in as Carneceria.');setAuthMessage('Superuser created.',true);enterApp()}catch(err){setAuthMessage(err.message||String(err))}finally{$('bootstrapForm').querySelector('button').disabled=false}};
$('logoutBtn').onclick=async()=>{cleanupBattle();await sb.auth.signOut();state.me=null;state.profile=null;state.role=null;showAuth()};
$('profileBtn').onclick=()=>openProfile();$('usersBtn').onclick=()=>{if(state.role==='superuser'){show('usersView');loadUsers()}};
async function openProfile(){show('profileView');$('profileUsername').value=state.profile.username;$('profileDisplayName').value=state.profile.display_name||state.profile.username;$('profileAvatar').textContent=(state.profile.display_name||state.profile.username).slice(0,1).toUpperCase();$('profileMessage').textContent=''}
$('saveProfileBtn').onclick=async()=>{const name=$('profileDisplayName').value.trim();if(!name)return $('profileMessage').textContent='Display name is required.';const {data,error}=await sb.from('profiles').update({display_name:name}).eq('id',state.me.id).select().single();if(error)return $('profileMessage').textContent=error.message;state.profile=data;enterApp();openProfile();}
$('changePasswordBtn').onclick=async()=>{const p=$('newPassword').value,p2=$('newPassword2').value;if(p.length<8)return $('profileMessage').textContent='Password must be at least 8 characters.';if(p!==p2)return $('profileMessage').textContent='Passwords do not match.';const {error}=await sb.auth.updateUser({password:p});$('profileMessage').textContent=error?error.message:'Password changed successfully.';if(!error){$('newPassword').value='';$('newPassword2').value=''}}
async function loadUsers(){if(state.role!=='superuser')return;const {data,error}=await sb.from('profiles').select('id,username,display_name,role,created_at,disabled').order('created_at');if(error){$('usersList').innerHTML=`<div class="empty">${esc(error.message)}</div>`;return}$('usersList').innerHTML=(data||[]).map(u=>`<div class="test-list-item"><div class="item-main"><b>${esc(u.display_name||u.username)}</b><small>@${esc(u.username)} · ${u.role} · ${u.disabled?'Disabled':'Active'}</small></div><div class="item-actions">${u.id!==state.me.id?`<button class="small-btn" data-disable-user="${u.id}">${u.disabled?'Enable':'Disable'}</button>`:''}</div></div>`).join('')||'<div class="empty">No users.</div>';document.querySelectorAll('[data-disable-user]').forEach(b=>b.onclick=()=>toggleUser(b.dataset.disableUser));}
$('createUserBtn').onclick=async()=>{if(state.role!=='superuser')return;const username=normalizeUsername($('newUsername').value),display=$('newDisplayName').value.trim()||username,password=$('newUserPassword').value;if(username.length<3)return $('usersMessage').textContent='Username must be at least 3 characters.';if(password.length<8)return $('usersMessage').textContent='Password must be at least 8 characters.';$('createUserBtn').disabled=true;const {data,error}=await sb.rpc('admin_create_user',{p_username:username,p_display_name:display,p_password:password});$('createUserBtn').disabled=false;if(error)return $('usersMessage').textContent=error.message;$('usersMessage').textContent=`Created @${username}.`;$('newUsername').value='';$('newDisplayName').value='';$('newUserPassword').value='';loadUsers()}
async function toggleUser(id){const {data,error}=await sb.from('profiles').select('disabled').eq('id',id).single();if(error)return $('usersMessage').textContent=error.message;const {error:e}=await sb.rpc('admin_set_user_disabled',{p_user:id,p_disabled:!data.disabled});if(e)return $('usersMessage').textContent=e.message;loadUsers()}

$('createLobbyCard').onclick=()=>openLobbyModal('create');
$('joinLobbyCard').onclick=()=>openLobbyModal('join');
$('adminBtn').onclick=()=>{if(state.role!=='superuser')return modal('Superuser only','Only Carneceria can manage tests.');if(!requireConfig())return;show('adminView');resetEditor();loadTests()};
$('historyBtn').onclick=()=>{if(!requireConfig())return;show('historyView');loadHistory();loadActiveBattles()};
$('resultsHomeBtn').onclick=()=>{cleanupBattle();show('homeView');loadActiveBattles();loadHistory()};
$('leaveFinishedBtn').onclick=()=>{cleanupBattle();show('homeView');loadActiveBattles()};
$('resetBtn')?.addEventListener('click',()=>location.reload());
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>{cleanupBattle();show('homeView')});
$('cancelEditBtn').onclick=resetEditor;

function code(){return Math.random().toString(36).slice(2,8).toUpperCase()}
async function openLobbyModal(mode){
  if(!requireConfig())return;
  if(mode==='create'){
    if(state.role!=='superuser')return modal('Only the superuser can create tests/lobbies','Ask Carneceria to create the test and lobby.');
    const {data,error}=await sb.from('tests').select('id,name,question_count,duration_minutes').eq('archived',false).order('updated_at',{ascending:false});
    if(error)return modal('Could not load tests',esc(error.message));
    $('modalContent').innerHTML=`<h3>Create a lobby</h3><p class="hint">Choose the test and player count.</p><select id="testSelectModal">${(data||[]).map(t=>`<option value="${t.id}">${esc(t.name)} — ${t.question_count} Q</option>`).join('')||'<option value="">No tests available</option>'}</select><select id="maxPlayersModal"><option value="2">2 players</option><option value="3" selected>3 players</option></select><button class="primary-btn full" id="modalAction">Create lobby</button>`;
  }else $('modalContent').innerHTML=`<h3>Join a lobby</h3><p class="hint">Enter the 6-character lobby code.</p><input id="lobbyCodeModal" maxlength="6" style="text-transform:uppercase" placeholder="A7K2P9"><button class="primary-btn full" id="modalAction">Join lobby</button>`;
  $('modal').classList.remove('hidden');$('modalAction').onclick=()=>mode==='create'?createLobby():joinLobby();
}
async function createLobby(){
  if(state.role!=='superuser')return modal('Only the superuser can create lobbies','Ask Carneceria to create the battle.');
  const testId=$('testSelectModal').value,maxPlayers=+$('maxPlayersModal').value;if(!testId)return modal('No test','Create a test first.');
  const {data:l,error}=await sb.from('lobbies').insert({code:code(),test_id:testId,status:'waiting',max_players:maxPlayers,created_by:state.me.id}).select('*').single();
  if(error)return modal('Could not create lobby',esc(error.message));
  const {error:pe}=await sb.from('lobby_players').insert({lobby_id:l.id,user_id:state.me.id,name:state.profile.display_name||state.profile.username,slot:1});
  if(pe){await sb.from('lobbies').delete().eq('id',l.id);return modal('Could not join lobby',esc(pe.message))}
  closeModal();state.lobby=l;await openLobby(l.id)
}
async function joinLobby(){
  const c=$('lobbyCodeModal').value.trim().toUpperCase();if(c.length!==6)return modal('Missing code','Enter the 6-character lobby code.');
  const {data,error}=await sb.rpc('join_lobby',{p_code:c});
  if(error)return modal('Could not join',esc(error.message));
  const row=Array.isArray(data)?data[0]:data;if(!row?.lobby_id)return modal('Could not join','The server did not return a lobby.');
  const {data:l,error:le}=await sb.from('lobbies').select('*').eq('id',row.lobby_id).single();if(le)return modal('Could not load lobby',esc(le.message));closeModal();state.lobby=l;await openLobby(l.id)
}

async function loadActiveBattles(){
  if(!sb||!state.me)return;
  const box=$('activeBattlesList');
  const historyActive=$('historyActiveList');
  const targets=[box,historyActive].filter(Boolean);
  if(!targets.length)return;
  targets.forEach(el=>el.innerHTML='<div class="empty">Loading active battles…</div>');
  const {data:members,error:memberError}=await sb.from('lobby_players')
    .select('lobby_id,finished,finished_at,current_question,answered_count,slot,name')
    .eq('user_id',state.me.id);
  if(memberError){targets.forEach(el=>el.innerHTML=`<div class="empty">${esc(memberError.message)}</div>`);return}
  const ids=[...new Set((members||[]).map(x=>x.lobby_id).filter(Boolean))];
  if(!ids.length){targets.forEach(el=>el.innerHTML='<div class="empty">No active battles. Start a new duel or join one with a code.</div>');return}
  const {data:lobbies,error:lobbyError}=await sb.from('lobbies')
    .select('id,code,status,max_players,created_by,test_id,start_time,created_at,tests(name,question_count,duration_minutes)')
    .in('id',ids)
    .in('status',['waiting','running'])
    .order('created_at',{ascending:false});
  if(lobbyError){targets.forEach(el=>el.innerHTML=`<div class="empty">${esc(lobbyError.message)}</div>`);return}
  const rows=(lobbies||[]).map(l=>({...l,mine:(members||[]).find(m=>m.lobby_id===l.id)}));
  const html=rows.length?rows.map(l=>{
    const host=l.created_by===state.me.id;
    const status=l.status==='waiting'?'Waiting for players':'Battle in progress';
    const progress=l.status==='running'&&l.mine?.finished?'You finished · waiting for the battle':'Resume where you left off';
    return `<div class="history-item active-battle-item"><div class="item-main"><b>${esc(l.tests?.name||'Battle')}</b><small>${esc(status)} · ${l.tests?.question_count||'—'} questions · ${esc(progress)}</small></div><div class="item-actions"><button class="small-btn" data-resume-lobby="${l.id}">${l.status==='waiting'?'Open lobby':'Resume'}</button>${host?`<button class="small-btn danger-btn" data-cancel-lobby="${l.id}">Cancel</button>`:''}</div></div>`;
  }).join(''):'<div class="empty">No active battles. Completed battles appear below.</div>';
  targets.forEach(el=>el.innerHTML=html);
  document.querySelectorAll('[data-resume-lobby]').forEach(b=>b.onclick=()=>resumeLobby(b.dataset.resumeLobby));
  document.querySelectorAll('[data-cancel-lobby]').forEach(b=>b.onclick=()=>cancelLobby(b.dataset.cancelLobby));
}
async function resumeLobby(id){
  const {data:l,error}=await sb.from('lobbies').select('*,tests(name,question_count,duration_minutes,question_types,page_rules,locked_pages,pdf_files)').eq('id',id).single();
  if(error)return modal('Could not resume battle',esc(error.message));
  state.lobby=l;closeModal();await openLobby(id);
}
async function cancelLobby(id){
  const {data:l,error:loadError}=await sb.from('lobbies').select('id,created_by,status').eq('id',id).single();
  if(loadError)return modal('Could not load battle',esc(loadError.message));
  if(l.created_by!==state.me.id)return modal('Host only','Only the host can cancel this battle.');
  if(!confirm('Cancel this battle? Players will no longer be able to resume it.'))return;
  // The database intentionally allows only waiting/running/finished lobby statuses.
  // A cancelled lobby is therefore removed instead of writing an invalid status.
  // The lobby's child rows (players/answers/attempts) cascade-delete in Supabase.
  const {error}=await sb.from('lobbies').delete().eq('id',id).eq('created_by',state.me.id).in('status',['waiting','running']);
  if(error)return modal('Could not cancel battle',esc(error.message));
  if(state.lobby?.id===id){
    cleanupBattle();
    state.lobby=null;state.players=[];state.mine=null;
    show('homeView');
  }
  await loadActiveBattles();
  await loadHistory();
}

async function openLobby(id){
  cleanupChannels();show('lobbyView');state.battleEntered=false;state.finishSubmitted=false;state.keyShown=false;state.resultsShown=false;
  await refreshLobby();
  if(state.lobbyChannel)sb.removeChannel(state.lobbyChannel);
  state.lobbyChannel=sb.channel('lobby-'+id)
    .on('postgres_changes',{event:'*',schema:'public',table:'lobby_players',filter:`lobby_id=eq.${id}`},()=>refreshLobby())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'lobbies',filter:`id=eq.${id}`},()=>refreshLobby())
    .subscribe();
}
async function refreshLobby(){
  if(!state.lobby)return;
  const {data:l}=await sb.from('lobbies').select('*,tests(name,question_count,duration_minutes,question_types,page_rules,locked_pages,pdf_files)').eq('id',state.lobby.id).maybeSingle();
  if(!l)return;state.lobby=l;
  const {data:ps}=await sb.from('lobby_players').select('*').eq('lobby_id',l.id).order('slot');state.players=ps||[];state.mine=state.players.find(p=>p.user_id===state.me.id)||null;
  if(l.status==='waiting'){renderLobby();return}
  if(l.status==='running'){if(!state.battleEntered)await enterBattle();else updateLivePlayers();return}
  if(l.status==='finished'){await loadFinishedAttempt();return}
  if(l.status==='cancelled'){cleanupBattle();modal('Lobby cancelled','This battle was cancelled.');show('homeView')}
}
function renderLobby(){
  $('lobbyCode').textContent=state.lobby.code;$('lobbyTestName').textContent=state.lobby.tests?.name||'—';$('lobbyQuestionCount').textContent=state.lobby.tests?.question_count||'—';$('lobbyDuration').textContent=(state.lobby.tests?.duration_minutes||'—')+' min';
  $('lobbyPlayers').innerHTML=Array.from({length:state.lobby.max_players},(_,i)=>{const slot=i+1,p=state.players.find(x=>x.slot===slot);return p?`<div class="player-slot"><span class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</span><div class="player-copy"><b>${esc(p.name)} ${p.user_id===state.me.id?'(you)':''}</b><small>Connected</small></div><span class="ready-badge">PLAYER ${slot}</span></div>`:`<div class="player-slot"><span class="avatar">${slot}</span><div class="player-copy"><b>Waiting…</b><small>Open the lobby code</small></div><span class="ready-badge">EMPTY</span></div>`}).join('');
  const canStart=state.lobby.created_by===state.me.id&&state.players.length>=2; $('startBtn').disabled=!canStart;$('startBtn').textContent=canStart?`Start ${state.players.length}-player battle`:`Waiting for ${state.lobby.max_players===3&&state.players.length===2?'one more player or start':'players'}…`;
}
$('startBtn').onclick=async()=>{
  if(!state.lobby)return;
  const start=new Date(Date.now()+4000).toISOString();
  const {error}=await sb.from('lobbies').update({status:'running',start_time:start}).eq('id',state.lobby.id).eq('status','waiting');
  if(error)modal('Could not start',esc(error.message));
};

async function enterBattle(){
  if(state.battleEntered||!state.lobby)return;
  state.battleEntered=true;state.test=state.lobby.tests;
  $('battleTestName').textContent=state.test.name;buildQuestionGrid(state.test.question_count);show('battleView');
  await loadPdfManifest(state.test);await hydrateAnswered();subscribeBattle();startTimer();updateLivePlayers();
}
function cleanupChannels(){if(state.lobbyChannel){sb?.removeChannel(state.lobbyChannel);state.lobbyChannel=null}if(state.battleChannel){sb?.removeChannel(state.battleChannel);state.battleChannel=null}}
function cleanupBattle(){clearInterval(state.timer);cleanupChannels();if(state.answerFeedbackTimer)clearTimeout(state.answerFeedbackTimer);state.battleEntered=false;state.finishSubmitted=false;state.keyShown=false;state.resultsShown=false;state.answerBusy=false;state.answers={};state.selected=null;state.pdfDocs=[];state.pages=[];state.visiblePages=[]}
function subscribeBattle(){
  if(state.battleChannel)sb.removeChannel(state.battleChannel);
  state.battleChannel=sb.channel('battle-'+state.lobby.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'lobby_players',filter:`lobby_id=eq.${state.lobby.id}`},async()=>{await refreshPlayersOnly()})
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'lobbies',filter:`id=eq.${state.lobby.id}`},async()=>{await refreshLobby()})
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'attempts',filter:`lobby_id=eq.${state.lobby.id}`},async()=>{await loadFinishedAttempt()})
    .subscribe();
}
async function refreshPlayersOnly(){
  const {data}=await sb.from('lobby_players').select('*').eq('lobby_id',state.lobby.id).order('slot');
  state.players=data||[];
  state.mine=state.players.find(p=>p.user_id===state.me.id)||state.mine;
  const allFinished=state.players.length>0&&state.players.every(p=>p.finished);
  if(state.lobby.status==='running'&&allFinished&&!state.keyShown&&!state.resultsShown){
    if(state.lobby.created_by===state.me.id) await transitionToKeyIfReady();
    else showWaitingFinish(false);
  } else updateLivePlayers();
}
function updateLivePlayers(){
  const others=state.players.filter(p=>p.user_id!==state.me.id);
  $('livePlayers').innerHTML=state.players.map(p=>`<div class="live-player"><span class="mini">${esc(p.name.slice(0,1).toUpperCase())}</span><div><b>${esc(p.name)}${p.user_id===state.me.id?' (you)':''}</b><small>${p.finished?'Finished':p.user_id===state.me.id?'You are solving':'Latest Q '+(p.current_question||'—')}</small></div><span class="live-count">${p.answered_count||0}</span></div>`).join('');
  updateBattleNudge();
  const mine=state.mine;
  const allFinished=state.players.length>0&&state.players.every(p=>p.finished);
  if(mine&&mine.finished&&!state.keyShown&&state.lobby.status==='running'){
    if(allFinished&&state.lobby.created_by===state.me.id) transitionToKeyIfReady();
    else showWaitingFinish(false);
  }
  if(others.length===1){/* layout intentionally supports any 2/3 player lobby */}
}
function updateBattleNudge(){
  const el=$('liveBattleNudge');if(!el)return;
  const mine=state.mine?.answered_count||0;
  const others=state.players.filter(p=>p.user_id!==state.me.id);
  if(!others.length){el.textContent='You are setting the pace. Make it count.';return}
  const counts=others.map(p=>p.answered_count||0);
  const leader=Math.max(...counts,0);
  const avg=counts.reduce((a,b)=>a+b,0)/counts.length;
  if(mine>leader)el.textContent=['You are ahead. Keep the pressure on.','Nice lead — do not give them a comeback.','You are setting the pace. 🚀'][mine%3];
  else if(mine===leader&&mine>0)el.textContent='Neck and neck. One clean answer can swing it.';
  else if(mine>=avg)el.textContent='You are right in the mix. Keep moving.';
  else if(mine+1>=leader)el.textContent='Closing the gap. Your next answer matters.';
  else el.textContent='They have the pace right now. Time to chase.';
}
function buildQuestionGrid(n){$('questionGrid').innerHTML=Array.from({length:n},(_,i)=>`<button class="q-btn" data-q="${i+1}">${i+1}</button>`).join('');document.querySelectorAll('.q-btn').forEach(b=>b.onclick=()=>selectQuestion(+b.dataset.q))}
async function hydrateAnswered(){
  const cacheKey='dueltest:answers:'+state.lobby.id+':'+state.me.id;
  let cached={};
  try{cached=JSON.parse(localStorage.getItem(cacheKey)||'{}')||{}}catch{}
  state.answers={...cached};
  Object.keys(state.answers).forEach(q=>document.querySelector(`.q-btn[data-q="${q}"]`)?.classList.add('answered'));
  const {data,error}=await sb.from('answers').select('question_number,answer').eq('lobby_id',state.lobby.id).eq('user_id',state.me.id);
  if(!error){state.answers={};(data||[]).forEach(a=>{state.answers[String(a.question_number)]=a.answer;document.querySelector(`.q-btn[data-q="${a.question_number}"]`)?.classList.add('answered')});try{localStorage.setItem(cacheKey,JSON.stringify(state.answers))}catch{}}
  const saved=Number(localStorage.getItem('dueltest:q:'+state.lobby.id));
  state.currentQ=(saved>=1&&saved<=state.test.question_count)?saved:1;
  await selectQuestion(state.currentQ);
}
function parseTypes(n,ranges){const types={};const tokens=(ranges||'').split(',').map(x=>x.trim()).filter(Boolean);for(const token of tokens){let [range]=token.split('=');if(range.includes('-')){let [a,b]=range.split('-').map(Number);if(!Number.isFinite(a)||!Number.isFinite(b))continue;a=Math.max(1,Math.min(n,a));b=Math.max(a,Math.min(n,b));for(let i=a;i<=b;i++)types[i]='INTEGER'}else{const q=Number(range);if(q>=1&&q<=n)types[q]='INTEGER'}}return types}
function typeFor(q){return (state.test.question_types||{})[String(q)]||'MCQ'}
function canonicalMultiAnswer(value){
  const chars=String(value||'').toUpperCase().replace(/\s+/g,'').split(',').filter(Boolean);
  return [...new Set(chars)].filter(x=>/^[A-D]$/.test(x)).sort().join(',');
}
async function selectQuestion(q){
  if(!state.test)return;
  q=Math.max(1,Math.min(state.test.question_count,q));
  state.currentQ=q;
  localStorage.setItem('dueltest:q:'+state.lobby.id,q);
  $('currentQuestion').textContent=q;
  $('battleProgress').textContent=`Question ${q} of ${state.test.question_count}`;
  const type=typeFor(q);
  $('currentTypeBadge').textContent=type==='MULTI_CORRECT'?'MULTI-CORRECT':type;
  $('mcqOptions').classList.toggle('hidden',type!=='MCQ'&&type!=='MULTI_CORRECT');
  $('submitMcq').classList.toggle('hidden',type!=='MCQ'&&type!=='MULTI_CORRECT');
  $('integerInputWrap').classList.toggle('hidden',type!=='INTEGER');
  $('submitMcq').textContent=type==='MULTI_CORRECT'?'Submit selected options':'Submit answer';
  document.querySelectorAll('.q-btn').forEach(b=>b.classList.toggle('active',+b.dataset.q===q));
  const a=state.answers[String(q)];
  state.selected=a||null;
  $('selectedAnswer').textContent=a?`Recorded: ${a}`:'No answer recorded';
  $('integerInput').value=type==='INTEGER'?(a||''):'';
  const selected=type==='MULTI_CORRECT'?canonicalMultiAnswer(a):a;
  document.querySelectorAll('.mcq-options button').forEach(b=>b.classList.toggle('selected',type==='MULTI_CORRECT'?canonicalMultiAnswer(selected).split(',').includes(b.dataset.answer):b.dataset.answer===a));
  const pageHint=(state.test.page_map||{})[String(q)];if(pageHint)gotoGlobalPage(pageHint);
}
document.querySelectorAll('.mcq-options button').forEach(b=>b.onclick=()=>{
  if(state.answerBusy)return;
  const type=typeFor(state.currentQ);
  if(type==='MULTI_CORRECT'){
    let vals=canonicalMultiAnswer(state.selected).split(',').filter(Boolean);
    vals=vals.includes(b.dataset.answer)?vals.filter(x=>x!==b.dataset.answer):[...vals,b.dataset.answer];
    state.selected=vals.sort().join(',');
    document.querySelectorAll('.mcq-options button').forEach(x=>x.classList.toggle('selected',vals.includes(x.dataset.answer)));
  }else{
    state.selected=b.dataset.answer;
    document.querySelectorAll('.mcq-options button').forEach(x=>x.classList.toggle('selected',x===b));
  }
  $('selectedAnswer').textContent=state.selected?`Selected: ${state.selected} · Press Enter to submit`:'No answer selected';
});
$('submitMcq').onclick=()=>recordAnswer(state.selected,{advance:true});
$('submitInteger').onclick=()=>recordAnswer($('integerInput').value.trim(),{advance:true});
function setAnswerFeedback(text,good=true){
  $('selectedAnswer').textContent=text;
  $('selectedAnswer').classList.toggle('answer-success',good);
}
async function recordAnswer(ans,{advance=true}={}){
  if(state.answerBusy||!state.mine||state.mine.finished)return false;
  if(!ans)return false;
  const q=state.currentQ;
  const type=typeFor(q);
  ans=String(ans).trim().toUpperCase();
  if(type==='MCQ'&&!['A','B','C','D'].includes(ans)){modal('Invalid answer','MCQ answers must be A, B, C or D.');return false}
  if(type==='MULTI_CORRECT'){ans=canonicalMultiAnswer(ans);if(!ans){modal('Select an answer','Select at least one option for this multi-correct question.');return false}}
  if(type==='INTEGER'&&!/^-?\d+$/.test(ans)){modal('Invalid integer','Enter a whole integer, including a leading minus sign if needed.');return false}
  state.answerBusy=true;
  const submitButtons=[$('submitMcq'),$('submitInteger')].filter(Boolean);
  submitButtons.forEach(b=>b.disabled=true);
  submitButtons.forEach(b=>{if(!b.classList.contains('hidden'))b.dataset.originalText=b.textContent});
  submitButtons.forEach(b=>{if(!b.classList.contains('hidden'))b.textContent='Saving…'});
  const {error}=await sb.from('answers').upsert({lobby_id:state.lobby.id,user_id:state.me.id,question_number:q,answer:ans},{onConflict:'lobby_id,user_id,question_number'});
  if(error){state.answerBusy=false;submitButtons.forEach(b=>{b.disabled=false;if(b.dataset.originalText)b.textContent=b.dataset.originalText});modal('Could not save answer',esc(error.message));return false}
  state.answers[String(q)]=ans;
  try{localStorage.setItem('dueltest:answers:'+state.lobby.id+':'+state.me.id,JSON.stringify(state.answers))}catch{}
  const count=Object.keys(state.answers).length;
  const {error:playerError}=await sb.from('lobby_players').update({current_question:q,answered_count:count}).eq('lobby_id',state.lobby.id).eq('user_id',state.me.id);
  if(playerError)console.warn('Could not update live progress:',playerError);
  state.mine={...state.mine,answered_count:count,current_question:q};
  document.querySelector(`.q-btn[data-q="${q}"]`)?.classList.add('answered');
  submitButtons.forEach(b=>{b.disabled=false;if(!b.classList.contains('hidden'))b.textContent='Saved ✓'});
  setAnswerFeedback(`Saved ✓  ${ans}`,true);
  if(state.answerFeedbackTimer)clearTimeout(state.answerFeedbackTimer);
  state.answerFeedbackTimer=setTimeout(async()=>{
    submitButtons.forEach(b=>{if(b.dataset.originalText)b.textContent=b.dataset.originalText});
    state.answerBusy=false;
    if(advance&&q<state.test.question_count)await selectQuestion(q+1);
    else if(advance&&q>=state.test.question_count)setAnswerFeedback(`Saved ✓  ${ans} · Last question`,true);
  },180);
  return true;
}

function handleBattleKeydown(e){
  if(!state.battleEntered||state.mine?.finished||$('battleView')?.classList.contains('hidden')||!$('battleView')?.classList.contains('active'))return;
  const tag=(e.target?.tagName||'').toLowerCase();
  const typing=tag==='input'||tag==='textarea'||tag==='select'||e.target?.isContentEditable;
  const type=typeFor(state.currentQ);
  if(typing){
    if(e.key==='Enter'&&tag==='input'&&type==='INTEGER'){e.preventDefault();recordAnswer($('integerInput').value.trim(),{advance:true});}
    return;
  }
  if(state.answerBusy)return;
  const key=e.key;
  if(['1','2','3','4','a','b','c','d','A','B','C','D'].includes(key)){
    e.preventDefault();
    const answer=/^[1-4]$/.test(key)?String.fromCharCode(64+Number(key)):key.toUpperCase();
    const btn=document.querySelector(`.mcq-options button[data-answer="${answer}"]`);
    if(!btn||$('mcqOptions').classList.contains('hidden'))return;
    btn.click();
    return;
  }
  if(key==='Enter'){
    e.preventDefault();
    if(type==='INTEGER')recordAnswer($('integerInput').value.trim(),{advance:true});
    else recordAnswer(state.selected,{advance:true});
    return;
  }
  if(key==='ArrowRight'){
    e.preventDefault();
    if(state.selected)recordAnswer(state.selected,{advance:true});
    else if(state.currentQ<state.test.question_count)selectQuestion(state.currentQ+1);
  }
  if(key==='ArrowLeft'){
    e.preventDefault();
    if(state.currentQ>1)selectQuestion(state.currentQ-1);
  }
}
window.addEventListener('keydown',handleBattleKeydown);

function parseList(s){const out=[];(s||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>{if(x.includes('-')){let[a,b]=x.split('-').map(Number);if(Number.isFinite(a)&&Number.isFinite(b)){a=Math.min(a,b);b=Math.max(a,b);for(let i=a;i<=b;i++)out.push(i)}}else{const n=Number(x);if(Number.isFinite(n))out.push(n)}});return [...new Set(out)].sort((a,b)=>a-b)}
function parsePartial(s){const out={};(s||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(x=>{const [range,val]=x.split('=').map(y=>y.trim());const pct=Math.max(5,Math.min(95,Number(val)));if(!Number.isFinite(pct))return;if(range.includes('-')){let[a,b]=range.split('-').map(Number);a=Math.min(a,b);b=Math.max(a,b);for(let i=a;i<=b;i++)out[i]=pct/100}else{const n=Number(range);if(Number.isFinite(n))out[n]=pct/100}});return out}
function parseTypeRanges(s,n,type){return parseList(s).filter(q=>q>=1&&q<=n).reduce((o,q)=>(o[q]=type,o),{})}

async function loadPdfManifest(t){
  state.pdfDocs=[];state.pages=[];state.visiblePages=[];let global=0;
  $('pdfMessage').textContent='Loading PDF…';
  for(const f of (t.pdf_files||[])){
    const {data:signed,error:signedError}=await sb.storage.from('test-pdfs').createSignedUrl(f.path, 3600);
    if(signedError||!signed?.signedUrl) throw signedError||new Error('Could not authorize PDF access.');
    const url=signed.signedUrl;
    try{const pdf=await window.pdfjsLib.getDocument({url,disableAutoFetch:false}).promise;state.pdfDocs.push({pdf,name:f.name,start:global});for(let i=1;i<=pdf.numPages;i++){global++;state.pages.push({global,doc:pdf,page:i,locked:(t.locked_pages||[]).includes(global),ratio:(t.page_rules||{})[String(global)]?.ratio||1})}}
    catch(e){console.error(e);modal('PDF could not load',`<p>${esc(f.name)}</p><p class="hint">${esc(e.message||e)}</p>`)}
  }
  state.visiblePages=state.pages.filter(p=>!p.locked);$('pageTotal').textContent=state.visiblePages.length||0;
  if(!state.visiblePages.length){$('pdfMessage').textContent='No accessible PDF pages remain.';return}
  state.pageIndex=0;await renderVisiblePage();
}
async function renderVisiblePage(){
  if(!state.visiblePages.length)return;
  const p=state.visiblePages[state.pageIndex];
  $('pageNumber').textContent=state.pageIndex+1;
  if(p.locked)return nextAccessible(1);
  $('pdfMessage').textContent='';
  const pg=await p.doc.getPage(p.page);
  const viewport=pg.getViewport({scale:state.zoom});
  const canvas=$('pdfCanvas'),wrap=$('pdfPageWrap');
  const outputScale=Math.min(Math.max(window.devicePixelRatio||1,1),3);
  canvas.width=Math.ceil(viewport.width*outputScale);
  canvas.height=Math.ceil(viewport.height*outputScale);
  canvas.style.width=Math.ceil(viewport.width)+'px';
  canvas.style.height=Math.ceil(viewport.height)+'px';
  wrap.style.width=Math.ceil(viewport.width)+'px';
  wrap.style.height=Math.ceil(viewport.height*p.ratio)+'px';
  const ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});
  ctx.setTransform(outputScale,0,0,outputScale,0,0);
  await pg.render({canvasContext:ctx,viewport}).promise;
  let cut=wrap.querySelector('.battle-cut-line');
  if(!cut){cut=document.createElement('div');cut.className='battle-cut-line';wrap.appendChild(cut)}
  let label=cut.querySelector('.battle-cut-label');
  if(!label){label=document.createElement('span');label.className='battle-cut-label';label.textContent='ANSWER AREA HIDDEN';cut.appendChild(label)}
  const ratio=Math.max(.05,Math.min(1,p.ratio||1));
  cut.style.top='calc(100% - 3px)';cut.style.display=ratio<.999?'block':'none';
}
function nextAccessible(delta){const next=state.pageIndex+delta;if(next<0||next>=state.visiblePages.length)return;state.pageIndex=next;renderVisiblePage()}
function gotoGlobalPage(global){const idx=state.visiblePages.findIndex(p=>p.global===global);if(idx>=0){state.pageIndex=idx;renderVisiblePage()}}
$('prevPage').onclick=()=>nextAccessible(-1);$('nextPage').onclick=()=>nextAccessible(1);$('zoomIn').onclick=()=>{state.zoom=Math.min(2.3,state.zoom+.12);renderVisiblePage()};$('zoomOut').onclick=()=>{state.zoom=Math.max(.7,state.zoom-.12);renderVisiblePage()};

function startTimer(){clearInterval(state.timer);const start=new Date(state.lobby.start_time).getTime(),dur=state.test.duration_minutes*60000;const tick=()=>{const left=Math.max(0,start+dur-Date.now()),s=Math.floor(left/1000);$('timer').textContent=[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');if(left<=0){clearInterval(state.timer);endMyTest(true)}};tick();state.timer=setInterval(tick,500)}
$('finishBtn').onclick=()=>endMyTest(false);
async function endMyTest(auto){
  if(state.finishSubmitted||state.mine?.finished)return;
  state.finishSubmitted=true;clearInterval(state.timer);$('finishBtn').disabled=true;
  const {error}=await sb.from('lobby_players').update({finished:true,finished_at:new Date().toISOString()}).eq('lobby_id',state.lobby.id).eq('user_id',state.me.id);
  if(error){state.finishSubmitted=false;$('finishBtn').disabled=false;return modal('Could not finish test',esc(error.message))}
  state.mine={...state.mine,finished:true};
  const {data:ps}=await sb.from('lobby_players').select('*').eq('lobby_id',state.lobby.id).order('slot');
  state.players=ps||[];state.mine=state.players.find(p=>p.user_id===state.me.id)||state.mine;
  const allFinished=state.players.length>0&&state.players.every(p=>p.finished);
  if(allFinished&&state.lobby.created_by===state.me.id) await transitionToKeyIfReady();
  else showWaitingFinish(auto);
}
function showWaitingFinish(auto=false){
  if(state.keyShown||state.resultsShown)return;
  show('waitingFinishView');
  const allFinished=state.players.length>0&&state.players.every(p=>p.finished);
  $('waitingFinishText').textContent=allFinished
    ? (state.lobby.created_by===state.me.id?'All players have finished.':'All players have finished. Waiting for the host to enter the answer key.')
    : (auto?'Time is up for you. Waiting for the other players to finish.':'You are finished. Waiting for the other players to finish. You can leave this page; it will resume when the battle is ready.');
  $('finishWaitList').innerHTML=state.players.map(p=>`<div class="wait-row"><span>${esc(p.name)}${p.user_id===state.me.id?' (you)':''}</span><small>${p.finished?'Finished':'Solving'}</small></div>`).join('')
}
async function transitionToKeyIfReady(){
  if(state.keyShown||state.resultsShown||state.lobby.created_by!==state.me.id)return;
  const {data:ps}=await sb.from('lobby_players').select('finished').eq('lobby_id',state.lobby.id);
  if(!ps?.length||!ps.every(p=>p.finished)){showWaitingFinish(false);return}
  state.players=ps.length===state.players.length?state.players:state.players;
  state.keyShown=true;clearInterval(state.timer);await refreshLobbyData();showAnswerKey()
}
async function refreshLobbyData(){const {data:l}=await sb.from('lobbies').select('*,tests(name,question_count,duration_minutes,question_types,page_rules,locked_pages,pdf_files)').eq('id',state.lobby.id).single();if(l)state.lobby=l}
function showAnswerKey(){
  if(state.lobby.created_by!==state.me.id){state.keyShown=false;showWaitingFinish(false);return}
  show('keyView');
  const types=state.test.question_types||{};
  $('answerKeyGrid').innerHTML=Array.from({length:state.test.question_count},(_,i)=>{const q=i+1,type=types[String(q)]||'MCQ';const placeholder=type==='MCQ'?'A / B / C / D':type==='INTEGER'?'Integer':'A,C / A,C,D';return `<div class="key-item"><label>Q${q} · ${type==='MULTI_CORRECT'?'MULTI-CORRECT':type}</label><input data-key="${q}" maxlength="12" placeholder="${placeholder}"></div>`}).join('');
  let saved={};try{saved=JSON.parse(localStorage.getItem('dueltest:key:'+state.lobby.id)||'{}')||{}}catch{}
  document.querySelectorAll('[data-key]').forEach(input=>{if(saved[input.dataset.key])input.value=saved[input.dataset.key];input.addEventListener('input',()=>saveAnswerKeyDraft())});
}
function saveAnswerKeyDraft(){
  const key={};document.querySelectorAll('[data-key]').forEach(i=>{const v=i.value.trim().toUpperCase();if(v)key[i.dataset.key]=v});
  try{localStorage.setItem('dueltest:key:'+state.lobby.id,JSON.stringify(key))}catch{}
}
$('submitKeyBtn').onclick=submitAnswerKey;
async function submitAnswerKey(){
  if(state.lobby.created_by!==state.me.id){return modal('Host only','Only the host can enter the official answer key and finish the battle.')}
  const key={};
  document.querySelectorAll('[data-key]').forEach(i=>{let v=i.value.trim();if(v)v=v.toUpperCase();key[i.dataset.key]=v});
  if(Object.values(key).some(v=>!v))return modal('Answer key incomplete','Every question needs an official answer.');
  for(let q=1;q<=state.test.question_count;q++){
    let v=key[String(q)];const type=typeFor(q);
    if(type==='MCQ'&&!['A','B','C','D'].includes(v))return modal('Invalid key',`Q${q} is MCQ; enter A, B, C or D.`);
    if(type==='INTEGER'&&!/^-?\d+$/.test(v))return modal('Invalid key',`Q${q} is INTEGER; enter a whole integer.`);
    if(type==='MULTI_CORRECT'){v=canonicalMultiAnswer(v);if(!v)return modal('Invalid key',`Q${q} is MULTI-CORRECT; enter one or more of A, B, C, D, separated by commas.`);key[String(q)]=v;}
  }
  saveAnswerKeyDraft();
  $('submitKeyBtn').disabled=true;
  const {data:attempt,error}=await sb.rpc('finalize_battle',{p_lobby_id:state.lobby.id,p_answer_key:key});
  if(error){$('submitKeyBtn').disabled=false;return modal('Could not finish battle',esc(error.message))}
  state.lobby.status='finished';
  try{localStorage.removeItem('dueltest:key:'+state.lobby.id)}catch{}
  renderResults(attempt.results,attempt.answer_key);
  loadHistory();loadActiveBattles();
  $('submitKeyBtn').disabled=false;
}

async function loadFinishedAttempt(){
  if(state.resultsShown)return;const {data:a}=await sb.from('attempts').select('*').eq('lobby_id',state.lobby.id).maybeSingle();if(!a)return;state.resultsShown=true;state.keyShown=false;state.test=state.lobby.tests||state.test;renderResults(a.results,a.answer_key)
}
function renderResults(results,key){
  state.resultsShown=true;clearInterval(state.timer);show('resultsView');const rows=Array.isArray(results)?results:[];const sorted=[...rows].sort((a,b)=>b.correct-a.correct||b.answered-a.answered);const myResult=rows.find(r=>r.user_id===state.me.id);const top=sorted[0]?.correct??0;const winners=rows.filter(r=>r.correct===top);$('resultHeadline').textContent=myResult&&myResult.correct===top?(winners.length===1?'You win!':'You are tied for first.'):'Battle complete.';
  $('scoreGrid').innerHTML=rows.map(r=>`<div class="score-card ${r.user_id===state.me.id&&r.correct===sorted[0]?.correct?'winner':''}"><span>${esc(r.name)}${r.user_id===state.me.id?' (you)':''}</span><strong>${r.correct}</strong><small>${r.correct} / ${state.test.question_count} correct · ${r.answered} answered</small></div>`).join('');
  const answersByQ={};rows.forEach(r=>Object.entries(r.answers||{}).forEach(([q,a])=>(answersByQ[q]??=[]).push({name:r.name,answer:a,uid:r.user_id})));$('comparisonRows').innerHTML=Array.from({length:state.test.question_count},(_,i)=>{const q=i+1,keyV=key[String(q)],type=typeFor(q),vals=rows.map(r=>{const a=r.answers?.[q]??'—';const same=type==='MULTI_CORRECT'?canonicalMultiAnswer(a)===canonicalMultiAnswer(keyV):String(a).toUpperCase()===String(keyV).toUpperCase();return `<span class="${same?'correct':'wrong'}">${esc(r.name)}: ${esc(a)}</span>`}).join(' ');return `<div class="comparison-row"><b>Q${q}</b><div class="answer-chip">${vals}</div><span class="muted">${esc(keyV)}</span></div>`}).join('');
}

// ---------- Test Manager ----------
function resetEditor(){state.editorId=null;state.editorExistingFiles=[];state.editorPdfDocs=[];state.editorPdfPages=[];state.editorPageIndex=0;state.partialRules={};$('editorTitle').textContent='Create a test';$('saveTestBtn').textContent='Create test';$('testNameInput').value='';$('durationInput').value=180;$('questionCountInput').value=90;$('pdfInput').value='';$('fileList').innerHTML='';$('existingFiles').innerHTML='';$('lockedPagesInput').value='';$('partialPagesInput').value='';$('integerRangesInput').value='';$('multiCorrectRangesInput').value='';$('partialRangeInput').value='';renderPartialRules();renderEditorPreview();setMessage('')}
$('pdfInput').onchange=async()=>{$('fileList').innerHTML=[...$('pdfInput').files].map((f,i)=>`<span class="file-chip">${i+1}. ${esc(f.name)}</span>`).join('');await loadEditorPdfsFromFiles([...$('pdfInput').files]);};
// ---------- Visual PDF cutoff editor ----------
function rulesToPartialString(){return Object.entries(state.partialRules).filter(([,v])=>Number(v)<100).sort((a,b)=>+a[0]-+b[0]).map(([p,v])=>`${p}=${v}`).join(',')}
function renderPartialRules(){if(!$('partialRulesSummary'))return;const entries=Object.entries(state.partialRules).filter(([,v])=>Number(v)<100).sort((a,b)=>+a[0]-+b[0]);$('partialPagesInput').value=entries.map(([p,v])=>`${p}=${v}`).join(',');$('partialRulesSummary').innerHTML=entries.length?entries.map(([p,v])=>`<span class="partial-rule-chip">Page ${p}: top ${v}% <button type="button" data-remove-partial="${p}" aria-label="Remove page ${p}">×</button></span>`).join(''):'No partial-page rules yet.';document.querySelectorAll('[data-remove-partial]').forEach(b=>b.onclick=()=>{delete state.partialRules[+b.dataset.removePartial];renderPartialRules();renderEditorPreview()})}
function editorSetPercent(v){v=Math.max(5,Math.min(100,Math.round(+v||100)));$('partialPercent').value=v;$('partialPercentValue').textContent=v+'%';const canvas=$('partialPreviewCanvas');if(!canvas.width)return;const h=canvas.height;const y=h*v/100;$('partialVisibleArea').style.height=y+'px';$('partialVisibleArea').style.display=v<100?'block':'none';$('partialHiddenArea').style.top=y+'px';$('partialHiddenArea').style.display=v<100?'block':'none';$('partialCutLine').style.top=y+'px';$('partialCutLine').style.display=v<100?'block':'none'}
async function renderEditorPreview(){const pages=state.editorPdfPages;if(!pages.length){$('partialPreviewMessage').style.display='block';$('partialPreviewCanvas').style.display='none';$('partialPageLabel').textContent='Page 1 / —';return}const page=pages[state.editorPageIndex];$('partialPreviewMessage').style.display='none';$('partialPreviewCanvas').style.display='block';$('partialPageInput').value=page.global;$('partialPageLabel').textContent=`Page ${page.global} / ${pages.length}`;const pg=await page.doc.getPage(page.page);const base=pg.getViewport({scale:1});const scale=Math.min(1.25,620/base.width);const vp=pg.getViewport({scale});const c=$('partialPreviewCanvas');const outputScale=Math.min(Math.max(window.devicePixelRatio||1,1),3);c.width=Math.ceil(vp.width*outputScale);c.height=Math.ceil(vp.height*outputScale);c.style.width=Math.ceil(vp.width)+'px';c.style.height=Math.ceil(vp.height)+'px';$('partialPreview').style.width=Math.ceil(vp.width)+'px';$('partialPreview').style.height=Math.ceil(vp.height)+'px';const ctx=c.getContext('2d',{alpha:false,desynchronized:true});ctx.setTransform(outputScale,0,0,outputScale,0,0);await pg.render({canvasContext:ctx,viewport:vp}).promise;editorSetPercent(state.partialRules[page.global]??100)}
function setEditorPage(global){global=Math.max(1,Math.min(state.editorPdfPages.length,+global||1));const i=state.editorPdfPages.findIndex(p=>p.global===global);if(i>=0){state.editorPageIndex=i;renderEditorPreview()}}
async function loadEditorPdfsFromFiles(files){state.editorPdfDocs=[];state.editorPdfPages=[];let global=0;for(const f of files){try{const url=URL.createObjectURL(f);const pdf=await window.pdfjsLib.getDocument({url}).promise;state.editorPdfDocs.push({pdf,url,name:f.name});for(let i=1;i<=pdf.numPages;i++)state.editorPdfPages.push({global:++global,doc:pdf,page:i})}catch(e){console.error(e);modal('Could not preview PDF',esc(e.message||e))}}state.editorPageIndex=0;renderEditorPreview()}
async function loadEditorPdfsFromStorage(files){state.editorPdfDocs=[];state.editorPdfPages=[];let global=0;for(const f of files){try{const {data:signed,error:signedError}=await sb.storage.from('test-pdfs').createSignedUrl(f.path,3600);if(signedError||!signed?.signedUrl)throw signedError||new Error('Could not authorize PDF preview.');const url=signed.signedUrl;const pdf=await window.pdfjsLib.getDocument({url}).promise;state.editorPdfDocs.push({pdf,url,name:f.name});for(let i=1;i<=pdf.numPages;i++)state.editorPdfPages.push({global:++global,doc:pdf,page:i})}catch(e){console.error(e)}}state.editorPageIndex=0;renderEditorPreview()}
function applyPartialPages(rangeText,pct){const pages=parseList(rangeText);if(!pages.length)return modal('No pages','Enter a page or range such as 12-15,31.');for(const p of pages)if(p>=1&&p<=state.editorPdfPages.length)state.partialRules[p]=pct;renderPartialRules();setEditorPage(pages[0])}
$('partialPercent')?.addEventListener('input',e=>editorSetPercent(e.target.value));
$('partialPageInput')?.addEventListener('change',e=>setEditorPage(e.target.value));
$('partialPrevPage')?.addEventListener('click',()=>setEditorPage((state.editorPdfPages[state.editorPageIndex]?.global||1)-1));
$('partialNextPage')?.addEventListener('click',()=>setEditorPage((state.editorPdfPages[state.editorPageIndex]?.global||1)+1));
$('applyPartialPage')?.addEventListener('click',()=>{const p=state.editorPdfPages[state.editorPageIndex]?.global;if(!p)return modal('No PDF page','Upload/open a test PDF first.');state.partialRules[p]=+$('partialPercent').value;renderPartialRules()});
$('applyPartialRange')?.addEventListener('click',()=>applyPartialPages($('partialRangeInput').value,+$('partialPercent').value));
$('partialCutLine')?.addEventListener('pointerdown',e=>{state.partialDrag=true;$('partialCutLine').setPointerCapture?.(e.pointerId)});
window.addEventListener('pointermove',e=>{if(!state.partialDrag)return;const r=$('partialPreview').getBoundingClientRect();editorSetPercent(Math.max(5,Math.min(100,Math.round(((e.clientY-r.top)/r.height)*100))))});
window.addEventListener('pointerup',()=>state.partialDrag=false);

async function saveTest(){
  if(state.role!=='superuser')return modal('Superuser only','Only Carneceria can create or edit tests.');
  const name=$('testNameInput').value.trim();
  const duration=Number($('durationInput').value);
  const questionCount=Number($('questionCountInput').value);
  const files=[...($('pdfInput').files||[])];
  const locked=parseList($('lockedPagesInput').value).filter(n=>n>=1);
  const pageRules={};
  Object.entries(state.partialRules||{}).forEach(([p,pct])=>{
    const n=Number(pct);
    if(Number.isFinite(n)&&n<100)pageRules[String(p)]={ratio:n/100};
  });
  const integerTypes=parseTypeRanges($('integerRangesInput').value,questionCount,'INTEGER');
  const multiTypes=parseTypeRanges($('multiCorrectRangesInput').value,questionCount,'MULTI_CORRECT');
  const overlap=Object.keys(integerTypes).filter(q=>multiTypes[q]);
  if(overlap.length)return setMessage(`Questions cannot be both INTEGER and MULTI-CORRECT: ${overlap.join(', ')}`);
  const questionTypes={...integerTypes,...multiTypes};

  if(!name)return setMessage('Test name is required.');
  if(!Number.isInteger(duration)||duration<1||duration>1440)return setMessage('Duration must be between 1 and 1440 minutes.');
  if(!Number.isInteger(questionCount)||questionCount<1||questionCount>1000)return setMessage('Number of questions must be between 1 and 1000.');
  if(!state.editorId&&!files.length)return setMessage('Select at least one PDF file.');
  if(files.some(f=>f.type!=='application/pdf'))return setMessage('Only PDF files are allowed.');
  if(locked.some(p=>p>100000))return setMessage('Invalid locked page number.');

  const btn=$('saveTestBtn');
  btn.disabled=true;
  setMessage(state.editorId?'Saving changes…':'Creating test…');

  const uploaded=[];
  try{
    let pdfFiles=state.editorExistingFiles||[];
    if(files.length){
      pdfFiles=[];
      for(const f of files){
        const safe=f.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const path=`tests/${state.me.id}/${crypto.randomUUID()}-${safe}`;
        const {error}=await sb.storage.from('test-pdfs').upload(path,f,{contentType:'application/pdf',upsert:false});
        if(error)throw new Error(`Could not upload ${f.name}: ${error.message}`);
        uploaded.push(path);
        pdfFiles.push({path,name:f.name});
      }
    }

    const payload={
      name,
      duration_minutes:duration,
      question_count:questionCount,
      question_types:questionTypes,
      locked_pages:locked,
      page_rules:pageRules,
      pdf_files:pdfFiles,
      archived:false,
      updated_at:new Date().toISOString()
    };

    const editing=!!state.editorId;
    let error=null;
    if(editing){
      const {error:e}=await sb.from('tests').update({...payload,version:(await getVersion(state.editorId))+1}).eq('id',state.editorId);
      error=e;
    }else{
      const {error:e}=await sb.from('tests').insert({...payload,owner_id:state.me.id}).select('id').single();
      error=e;
    }
    if(error)throw error;

    if(editing&&files.length&&state.editorExistingFiles?.length){
      const oldPaths=state.editorExistingFiles.map(f=>f.path).filter(Boolean);
      if(oldPaths.length)await sb.storage.from('test-pdfs').remove(oldPaths);
    }

    resetEditor();
    await loadTests();
    setMessage(editing?'Test saved successfully.':'Test created successfully.');
  }catch(e){
    if(uploaded.length)await sb.storage.from('test-pdfs').remove(uploaded).catch(()=>{});
    console.error('saveTest failed',e);
    setMessage(e?.message||String(e));
  }finally{
    btn.disabled=false;
  }
}
$('saveTestBtn').onclick=saveTest;

async function loadTests(){if(!sb||!state.me)return;const {data,error}=await sb.from('tests').select('id,owner_id,name,question_count,duration_minutes,updated_at,pdf_files').eq('archived',false).order('updated_at',{ascending:false});if(error){if($('testsList'))$('testsList').innerHTML=`<div class="empty">${esc(error.message)}</div>`;return}$('testsList').innerHTML=(data||[]).map(t=>`<div class="test-list-item"><div class="item-main"><b>${esc(t.name)}</b><small>${t.question_count} questions · ${t.duration_minutes} min · updated ${new Date(t.updated_at).toLocaleString()}</small></div><div class="item-actions">${state.role==='superuser'?`<button class="small-btn" data-edit="${t.id}">Edit</button><button class="small-btn danger-btn" data-delete="${t.id}">Archive</button>`:''}</div></div>`).join('')||'<div class="empty">No tests yet.</div>';document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editTest(b.dataset.edit));document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteTest(b.dataset.delete));}
async function claimTest(id){const {error}=await sb.from('tests').update({owner_id:state.me.id}).eq('id',id).is('owner_id',null);if(error)return modal('Could not claim test',esc(error.message));loadTests()}
async function editTest(id){const {data:t,error}=await sb.from('tests').select('*').eq('id',id).single();if(error)return modal('Could not load test',esc(error.message));if(state.role!=='superuser')return modal('Superuser only','Only Carneceria can edit tests.');state.editorId=id;state.editorExistingFiles=t.pdf_files||[];state.editorPdfDocs=[];state.editorPdfPages=[];state.editorPageIndex=0;state.partialRules={};Object.entries(t.page_rules||{}).forEach(([p,r])=>state.partialRules[+p]=Math.round((r.ratio||1)*100));$('editorTitle').textContent='Edit test';$('saveTestBtn').textContent='Save changes';$('testNameInput').value=t.name;$('durationInput').value=t.duration_minutes;$('questionCountInput').value=t.question_count;$('pdfInput').value='';$('fileList').innerHTML='';$('existingFiles').innerHTML=state.editorExistingFiles.map((f,i)=>`<span class="file-chip">${i+1}. ${esc(f.name)}</span>`).join('');$('lockedPagesInput').value=(t.locked_pages||[]).join(',');$('partialPagesInput').value=Object.entries(t.page_rules||{}).map(([p,r])=>`${p}=${Math.round((r.ratio||1)*100)}`).join(',');$('integerRangesInput').value=typesToRanges(t.question_types||{},'INTEGER');$('multiCorrectRangesInput').value=typesToRanges(t.question_types||{},'MULTI_CORRECT');renderPartialRules();await loadEditorPdfsFromStorage(state.editorExistingFiles);window.scrollTo({top:0,behavior:'smooth'})}
function typesToRanges(types,wantedType='INTEGER'){const nums=Object.entries(types).filter(([,v])=>v===wantedType).map(([q])=>+q).sort((a,b)=>a-b);const out=[];for(let i=0;i<nums.length;i++){let a=nums[i],b=a;while(nums[i+1]===b+1){b=nums[++i]}out.push(a===b?String(a):`${a}-${b}`)}return out.join(',')}
async function deleteTest(id){if(state.role!=='superuser')return;if(!confirm('Archive this test? Existing battle history will remain available.'))return;const {error}=await sb.from('tests').update({archived:true}).eq('id',id);if(error)return modal('Could not archive test',esc(error.message));loadTests()}
async function getVersion(id){const {data}=await sb.from('tests').select('version').eq('id',id).single();return data?.version||1}

async function viewHistory(id){const {data:a,error}=await sb.from('attempts').select('*').eq('id',id).single();if(error)return modal('Could not load battle',esc(error.message));const {data:t}=await sb.from('tests').select('question_count,question_types,name').eq('id',a.test_id).maybeSingle();state.test=t||{question_count:Math.max(...(a.results||[]).flatMap(r=>Object.keys(r.answers||{}).map(Number)),0),question_types:{},name:a.test_name};show('resultsView');renderResults(a.results,a.answer_key)}

async function loadHistory(){
  const {data,error}=await sb.from('attempts').select('id,test_id,test_name,completed_at,results').order('completed_at',{ascending:false});
  if(error){$('historyList').innerHTML=`<div class="empty">${esc(error.message)}</div>`;return}
  $('historyList').innerHTML=(data||[]).map(a=>{const me=a.results?.find(r=>r.user_id===state.me.id);return `<div class="history-item"><div class="item-main"><b>${esc(a.test_name)}</b><small>${new Date(a.completed_at).toLocaleString()} · ${(a.results||[]).length} players</small></div><div class="history-score">${me?.correct??0} correct</div><div class="item-actions"><button class="small-btn" data-history="${a.id}">View</button></div></div>`}).join('')||'<div class="empty">No completed battles yet.</div>';
  document.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>viewHistory(b.dataset.history));
}

// A small guard against stale tabs attempting to re-enter a finished battle.
window.addEventListener('beforeunload',()=>{clearInterval(state.timer);if(state.lobbyChannel)sb?.removeChannel(state.lobbyChannel);if(state.battleChannel)sb?.removeChannel(state.battleChannel)});
