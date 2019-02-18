function firstIndexOf(buf: Buffer, arr: Buffer[]) {
	for (let i = 0; i < arr.length; i++) {
		if (buf.equals(arr[i])) {
			return i;
		}
	}

	return -1;
}

let debug = false;

// Protection against second preimage attacks
// See https://flawed.net.nz/2018/02/21/attacking-merkle-trees-with-a-second-preimage-attack/
const LEAF_PREFIX = Buffer.from('00', 'hex');
const BRANCH_PREFIX = Buffer.from('01', 'hex');

type HashFunction = (buf: Buffer) => Buffer;
type MerkleTreeProof = {
	root: Buffer;
	leaf: Buffer;
	proofs: Buffer[];
	paths: boolean[];
}

class MerkleTree {
	items: Buffer[];
	leaves: Buffer[];
	layers: Buffer[][];
	nLayers: number;
	hashFn: (buf: Buffer) => Buffer;
	hashSizeBytes: number;

	constructor(items: Buffer[], hashFn: HashFunction) {
		let leaves = items;
		this.items = items;
		this.hashFn = hashFn;
		this.hashSizeBytes = hashFn(BRANCH_PREFIX).byteLength;

		// compute the balanced layer
		if(leaves.length === 1) leaves = leaves.concat(leaves)
		let balancedLeaves = new Array<Buffer>(
			Math.pow(2, Math.ceil(Math.log2(
				leaves.length
			)))
		);

		for(let j = 0; j < balancedLeaves.length; j++) {
			if(j > (leaves.length-1)) {
				balancedLeaves[j] = leaves[leaves.length - 1];
			} else {
				balancedLeaves[j] = leaves[j];
			}
		}

		leaves = balancedLeaves;

		// Now hash all.
		this.leaves = leaves.map(leaf => this.hashLeaf(leaf))
		
		// And compute tree
		this.layers = this.computeTree(this.leaves);
	}

	root(): Buffer {
		if (this.layers[0].length == 0) throw new Error("no leaves in tree");
		return this.layers[this.nLayers - 1][0];
	}

	hashLeaf(leaf: Buffer): Buffer {
		return hashLeaf(this.hashFn, leaf);
	}

	hashBranch(left, right: Buffer): Buffer {
		if (left.byteLength != this.hashSizeBytes || right.byteLength != this.hashSizeBytes) {
			throw new Error("branches should be of hash size already");
		}
		return hashBranch(this.hashFn, left, right)
	}

	findLeafIndex(item: Buffer) {
		let idx = firstIndexOf(this.hashLeaf(item), this.layers[0]);
		if(idx == -1) throw new Error('item not found');
		return idx
	}

	findLeaf(item: Buffer) {
		return this.layers[0][this.findLeafIndex(item)]
	}

	generateProof(idx: number): MerkleTreeProof {
		let proofs: Buffer[] = new Array(this.nLayers - 1);
		let paths = [];
		let leaf = this.layers[0][idx]

		for (let i = 0; i < proofs.length; i++) {
			let layer = this.layers[i];

			// if (i == this.nLayers - 1) {
			// 	proof[i] = layer[0];
			// } else {
			// 	const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
			// 	proof[i] = layer[pairIdx];
			// 	idx = Math.floor(idx / 2);
			// }
			let isLeftNode = idx % 2 === 0;
			paths.push(!isLeftNode);

			const pairIdx = isLeftNode ? idx + 1 : idx - 1;
			proofs[i] = layer[pairIdx];
			idx = Math.floor(idx / 2);
		}

		return { proofs, paths, leaf, root: this.root() }
	}

	// TODO remove leaf param
	verifyProof(proof: MerkleTreeProof, leaf?: Buffer) {
		if(!leaf) {
			leaf = proof.leaf;
		}
		if (proof.proofs.length != this.nLayers - 1) throw new Error(`${proof.proofs.length} proof nodes, but only ${this.nLayers} layers in tree`)
		if(firstIndexOf(leaf, this.layers[0]) == -1) throw new Error(`Leaf doesn't exist in original tree`);
		return verifyProof(this.hashFn, proof, this.root(), leaf);
	}

	private computeTree(leaves: Buffer[]) {
		// 0th layer is the leaves
		this.nLayers = Math.ceil(Math.log2(leaves.length)) + 1;
		let layers: Buffer[][] = new Array<Buffer[]>(this.nLayers);

		for (let i = 0; i < this.nLayers; i++) {
			if (i == 0) {
				layers[i] = leaves;
				continue;
			} else {
				layers[i] = this.computeLayer(layers[i - 1]);
			}

		}

		return layers;
	}

	computeLayer(leaves: Buffer[]): Buffer[] {
		let nodes: Buffer[] = [];

		// Make sure it's even
		if (leaves.length % 2 == 1) {
			// Some languages (ie Solidity) don't have prepend, so this makes compatible implementations easier.
			leaves = [...leaves, leaves[leaves.length - 1]]
		}

		for (let i = 0; i < leaves.length;) {
			nodes.push(
				this.hashBranch(leaves[i], leaves[i + 1])
			);
			i += 2;
		}

		return nodes;
	}

	toString() {
		let str = "";
		
		let j = 0;

		this.layers.map((layer, i) => {
			str += `Layer ${i} - \n`;
			
			for (let node of layer) {
				str += '\t ' + node.toString('hex');
				if(i == 0) {
					if(j < this.items.length)
						str += '\t' + this.items[j++].toString('hex')
				}
				str += '\n';
			}
		})
		return str;
	}
}


function hashLeaf(hashFn: HashFunction, leaf: Buffer): Buffer {
	return hashFn(Buffer.concat([LEAF_PREFIX, leaf]))
}

function hashBranch(hashFn: HashFunction, left, right: Buffer): Buffer {
	return hashFn(Buffer.concat([BRANCH_PREFIX, left, right]))
}

function verifyProof(hashFn: HashFunction, proof: MerkleTreeProof, root: Buffer, leaf: Buffer) {
	let node = leaf;

	// node > proof
	// node.compare(proof[0]) == 1
	let { proofs, paths } = proof;

	for (let i = 0; i < proofs.length; i++) {
		let pairNode = proofs[i];

		if(debug) {
			console.log(`Verifying layer ${i}`)
			console.log(`\t`, node)
			console.log(`\t`, pairNode)
		}

		if(paths[i]) {
			node = hashBranch(hashFn, pairNode, node)
		} else {
			node = hashBranch(hashFn, node, pairNode)
		}
	}

	if(debug) {
		console.log(`Verify root`)
		console.log('\t', root)
		console.log('\t', node)
	}

	return root.equals(node);
}

export {
	MerkleTree,
	MerkleTreeProof,
	hashLeaf,
	hashBranch,
	verifyProof,
	LEAF_PREFIX,
	BRANCH_PREFIX
};