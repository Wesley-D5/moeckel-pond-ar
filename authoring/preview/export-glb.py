"""Export a shared tabletop scene as an embedded-texture, animated glTF 2.0 binary."""
from pathlib import Path
import sys
import json
import math
import struct
import mimetypes
from collections import defaultdict
import numpy as np

scene_path, output_path = map(Path, sys.argv[1:3])
scene = json.loads(scene_path.read_text())
identity = np.eye(4, dtype=float)
binary = bytearray()
model = {
    'asset': {'version': '2.0', 'generator': 'Moeckel Pond shared-scene exporter'},
    'scene': 0, 'scenes': [{'name': 'Moeckel Pond', 'nodes': [0]}],
    'nodes': [{'name': 'Moeckel Pond'}], 'meshes': [], 'materials': [],
    'buffers': [], 'bufferViews': [], 'accessors': [], 'images': [], 'textures': [],
    'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
}

def buffer_view(data, target=None):
    binary.extend(b'\x00' * (-len(binary) % 4))
    view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
    if target:
        view['target'] = target
    idx = len(model['bufferViews'])
    model['bufferViews'].append(view)
    binary.extend(data)
    return idx

def accessor(array, kind, target=None, bounds=False):
    array = np.ascontiguousarray(array)
    codes = {np.dtype('<f4'): 5126, np.dtype('<u2'): 5123, np.dtype('<u4'): 5125}
    result = {'bufferView': buffer_view(array.tobytes(), target), 'componentType': codes[array.dtype],
              'count': len(array), 'type': kind}
    if bounds:
        result.update(min=np.atleast_1d(array.min(axis=0)).tolist(), max=np.atleast_1d(array.max(axis=0)).tolist())
    model['accessors'].append(result)
    return len(model['accessors']) - 1

def quaternion(rot):
    # USD rotateXYZ applies X then Y then Z to a point (qZ * qY * qX).
    x,y,z = np.deg2rad(rot) * 0.5
    sx,sy,sz = np.sin([x,y,z])
    cx,cy,cz = np.cos([x,y,z])
    return np.array([sx*cy*cz - cx*sy*sz, cx*sy*cz + sx*cy*sz,
                     cx*cy*sz - sx*sy*cz, cx*cy*cz + sx*sy*sz])

def qmultiply(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return np.r_[a[3]*b[:3] + b[3]*a[:3] + np.cross(a[:3], b[:3]), a[3]*b[3] - np.dot(a[:3], b[:3])]

def transform(node):
    x,y,z,w = quaternion(node.get('rotation', [0,0,0]))
    matrix = np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0],
                       [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0],
                       [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0], [0,0,0,1]])
    matrix[:3,3] = node.get('translation', [0,0,0])
    return matrix

images = {}
materials = {}
def material_index(name, double_sided):
    key = (name, double_sided)
    if key in materials:
        return materials[key]
    source = scene['materials'][name]
    pbr = {'baseColorFactor': [*source['color'],1], 'roughnessFactor': source['roughness'],
           'metallicFactor': source.get('metallic',0)}
    if 'texture' in source:
        filename = source['texture']
        if filename not in images:
            image_path = scene_path.parent / filename
            index = len(model['images'])
            model['images'].append({'name': image_path.stem, 'mimeType': mimetypes.guess_type(filename)[0],
                                    'bufferView': buffer_view(image_path.read_bytes())})
            model['textures'].append({'sampler':0,'source':index})
            images[filename] = index
        pbr['baseColorTexture'] = {'index':images[filename]}
    mat = {'name': name, 'pbrMetallicRoughness':pbr}
    if double_sided:
        mat['doubleSided'] = True
    materials[key] = len(model['materials'])
    model['materials'].append(mat)
    return materials[key]

children = defaultdict(list)
for node in scene['nodes']:
    children[node.get('parent')].append(node)
parts = defaultdict(list)
motion = {'name':'Moeckel Pond in motion', 'channels': [], 'samplers': []}
def visit(node, parent_index, incoming, ancestor_q):
    transform_here = incoming @ transform(node)
    rotation = quaternion(node.get('rotation',[0,0,0]))
    combined_q = qmultiply(ancestor_q, rotation)
    animation = node.get('animation')
    if animation:
        index = len(model['nodes'])
        model['nodes'][parent_index].setdefault('children', []).append(index)
        model['nodes'].append({'name':node['name'], 'translation':transform_here[:3,3].tolist(),
                               'rotation': combined_q.tolist()})
        axis = 'XYZ'.index(animation['axis'])
        times, angles = [], []
        for time, angle in zip(animation['times'],animation['angles']):
            if angles:
                split = max(1,math.ceil(abs(angle-angles[-1])/85))
                times.extend(np.linspace(times[-1],time,split+1).tolist()[1:])
                angles.extend(np.linspace(angles[-1],angle,split+1).tolist()[1:])
            else:
                times.append(time); angles.append(angle)
        values=[]
        for angle in angles:
            rot = list(node.get('rotation',[0,0,0])); rot[axis]=angle
            q = qmultiply(ancestor_q,quaternion(rot))
            if values and np.dot(values[-1],q)<0:
                q=-q
            values.append(q)
        motion['channels'].append({'sampler':len(motion['samplers']),'target':{'node':index,'path':'rotation'}})
        motion['samplers'].append({'input':accessor(np.array(times,dtype='<f4'),'SCALAR',bounds=True),
                                   'output':accessor(np.array(values,dtype='<f4'),'VEC4'),'interpolation':'LINEAR'})
        parent_index,transform_here,combined_q=index,identity,[0,0,0,1]
    data=node.get('mesh')
    if data:
        points=np.array(data['points'],dtype=float)
        indices=np.asarray(data['indices'],dtype=np.int64).reshape(-1,3)
        points=np.einsum('ab,nb->na',transform_here[:3,:3],points) + transform_here[:3,3]
        assert np.isfinite(points).all(), node['name']
        triangles=points[indices]
        normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
        lengths=np.linalg.norm(normals,axis=1)
        valid=lengths>1e-13
        indices, triangles, normals = indices[valid],triangles[valid],normals[valid]/lengths[valid,None]
        if len(normals):
            if 'Relief' in node['name'] or 'Ground' in node['name']:
                smooth=np.zeros_like(points)
                for i in range(3):
                    np.add.at(smooth,indices[:,i],normals)
                smooth/=np.maximum(np.linalg.norm(smooth,axis=1)[:,None],1e-10)
                normals=smooth[indices]
            else:
                normals=np.repeat(normals[:,None,:],3,axis=1)
            channels=[triangles.reshape(-1,3), normals.reshape(-1,3)]
            uv = data.get('uvs')
            if uv:
                uv = np.asarray(uv, dtype=float).copy()
                uv[:,1]=1-uv[:,1]
                channels.append(uv[indices].reshape(-1,2))
            mat = material_index(data['material'],bool(data.get('doubleSided', False)))
            parts[(parent_index,mat,bool(uv is not None and len(uv)))].append(np.concatenate(channels,axis=1))
    for child in children[node['name']]:
        visit(child,parent_index,transform_here,combined_q)

for root in children[None]+children['']:
    visit(root,0,identity,[0,0,0,1])
for (node_id, mat, has_uv), batch in parts.items():
    node=model['nodes'][node_id]
    if 'mesh' not in node:
        node['mesh']=len(model['meshes'])
        model['meshes'].append({'name':node['name'],'primitives':[]})
    # Bake stationary pieces together by material, preserving each animated transform.
    rows = np.round(np.concatenate(batch,axis=0),7).astype('<f4')
    vertices, idx = np.unique(rows,axis=0,return_inverse=True)
    attrs={'POSITION':accessor(vertices[:,:3],'VEC3',34962,True),
           'NORMAL':accessor(vertices[:,3:6],'VEC3',34962)}
    if has_uv:
        attrs['TEXCOORD_0']=accessor(vertices[:,6:8],'VEC2',34962)
    index_type='<u2' if len(vertices)<65536 else '<u4'
    index=accessor(idx.astype(index_type).reshape(-1),'SCALAR',34963)
    model['meshes'][node['mesh']]['primitives'].append({'attributes':attrs,'indices':index,'material':mat})
if motion['channels']:
    model['animations']=[motion]
if not model['textures']:
    for key in ['images','textures','samplers']:
        model.pop(key)
binary.extend(b'\x00' * (-len(binary) % 4))
model['buffers'].append({'byteLength':len(binary)})
header=json.dumps(model,separators=(',',':')).encode('utf8')
header+=b' '*(-len(header)%4)
output_path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(header)+len(binary))+
                        struct.pack('<I4s',len(header),b'JSON')+header+
                        struct.pack('<I4s',len(binary),b'BIN\x00')+binary)
print(f"{output_path.name} · {output_path.stat().st_size:,} bytes, {len(model['meshes'])} mesh groups, {len(parts)} draw calls, {len(motion['channels'])} animation channels")
