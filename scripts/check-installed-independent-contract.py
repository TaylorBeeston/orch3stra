"""Read-only installed WanGP validator/scheduler regression. No imports of models or inference."""
import ast,importlib.util,json,sys,subprocess
from pathlib import Path
root=Path(sys.argv[1]).resolve();source=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
extra=module('h3_contract_extra',root/'shared/extra_settings.py');scheduler=module('h3_contract_scheduler',root/'shared/utils/frame_scheduler.py')
tree=ast.parse((root/'models/minimax_h3/minimax_h3_handler.py').read_text());defaults=[];values={}
for n in ast.walk(tree):
 if not isinstance(n,ast.Dict):continue
 for k,v in zip(n.keys,n.values):
  if isinstance(k,ast.Constant) and k.value in ['frames_minimum','frames_steps','frames_offset','image_end_frame_position'] and isinstance(v,ast.Constant):values[k.value]=v.value
 try:d=ast.literal_eval(n)
 except (ValueError,TypeError):continue
 if isinstance(d,dict) and d.get('window_min')==124 and d.get('overlap_step')==17 and d.get('overlap_min')==1:defaults.append(d)
assert defaults;model={'sliding_window':True,'sliding_window_defaults':defaults[0]};bound=extra.get_def('sliding_window_overlap',model)
assert extra.validate_resolved_value(bound,0)=='Windows Frames Overlap must be at least 1.'
js="const H=require('./core.js');const p=H.demo();p.modelType='minimax_h3_ref2va_pruned';p.mode='independent';p.windows=p.windows.slice(0,1);p.windows[0].frames=124;p.windows[0].overlap=0;console.log(JSON.stringify({task:H.tasks(p)[0],plan:H.renderPlan(p)}))"
compiled=json.loads(subprocess.check_output(['node','-e',js],cwd=source));task=compiled['task'];assert extra.validate_resolved_value(bound,task['sliding_window_overlap']) is None
assert task['video_source'] is None and task['video_guide'] is None and '_director_continuation' not in task
assert task['video_length']==124 and compiled['plan'][0]['start_frame']==0 and compiled['plan'][0]['end_frame']==124
# Execute only the installed pure early-return context estimator: no video probe/model loads.
f=next(n for n in ast.parse((root/'wgp.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='estimate_first_window_overlap_frames');ns={};exec(compile(ast.Module(body=[f],type_ignores=[]),'installed-context-estimator','exec'),ns);available=ns[f.name](None,None,'',24);assert available==0
windows=scheduler.build_default_window_plan(total_frames=124,window_size=362,default_overlap=task['sliding_window_overlap'],discard_last_frames=0,minimum=107,step=17,frame_offset=5,overlap_offset=1,max_overlap=120,first_window_overlap=min(1,available),first_window_available_overlap=available,initial_shared_frames=0,preserve_exact_output_frames=True)
assert len(windows)==1 and windows[0]['overlap_frames']==0 and windows[0]['output_frames']==124,windows
print(json.dumps({'installed_overlap_bounds':{'min':bound.min,'max':bound.max,'step':bound.step},'old_zero_rejected':True,'compiled_api_overlap':task['sliding_window_overlap'],'available_previous_context_frames':available,'installed_scheduler':windows,'no_inference':True},indent=2))
