// LOCAL ONLY gas measurement: deploys MockAgentID + AgentProof on the
// Hardhat in-process network and measures gasUsed for deploy / issue /
// confirm / cancel from transaction receipts. No live network, no keys.
const { ethers } = require("hardhat");

(async () => {
  const [deployer, issuer, recipient] = await ethers.getSigners();

  const Mock = await ethers.getContractFactory("MockAgentID");
  const mock = await Mock.deploy();
  const mockReceipt = await mock.deploymentTransaction().wait();
  console.log("mockDeployGas:", mockReceipt.gasUsed.toString());

  const Proof = await ethers.getContractFactory("AgentProof");
  const proof = await Proof.deploy(await mock.getAddress());
  const deployReceipt = await proof.deploymentTransaction().wait();
  console.log("agentProofDeployGasUsed:", deployReceipt.gasUsed.toString());
  console.log("agentProofAddress(local):", await proof.getAddress());

  await (await mock.setHolder(issuer.address, true)).wait();
  await (await mock.setHolder(recipient.address, true)).wait();

  // issue with a realistic title + evidence URI
  const issueTx = await proof
    .connect(issuer)
    .issueReceipt(recipient.address, 0, "Delivered the audit report", "ipfs://evidence-1");
  const issueReceipt = await issueTx.wait();
  console.log("issueReceiptGasUsed:", issueReceipt.gasUsed.toString());

  const confirmTx = await proof.connect(recipient).confirmReceipt(0);
  const confirmReceipt = await confirmTx.wait();
  console.log("confirmReceiptGasUsed:", confirmReceipt.gasUsed.toString());

  // second issue + cancel for completeness
  const issue2Tx = await proof
    .connect(issuer)
    .issueReceipt(recipient.address, 4, "Helped moderate the community call", "");
  const issue2Receipt = await issue2Tx.wait();
  console.log("issueReceipt2GasUsed(emptyEvidence):", issue2Receipt.gasUsed.toString());
  const cancelTx = await proof.connect(issuer).cancelReceipt(1);
  const cancelReceipt = await cancelTx.wait();
  console.log("cancelReceiptGasUsed:", cancelReceipt.gasUsed.toString());

  // also: ethers estimateGas for the deployment (local) as a cross-check
  const factory = await ethers.getContractFactory("AgentProof");
  const estDeploy = await factory.getDeployTransaction(await mock.getAddress());
  const est = await ethers.provider.estimateGas({ ...estDeploy, from: deployer.address });
  console.log("localEstimateGasDeploy:", est.toString());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
