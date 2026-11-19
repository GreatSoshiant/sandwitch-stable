// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Independent EIP-1167 storage for each backup, using ZeroDev's patched
/// passkey validator implementation. No owner or upgrade mechanism.
contract BackupValidatorFactory {
    address public immutable implementation;
    constructor(address target) { require(target.code.length > 0,"missing validator"); implementation=target; }
    function creationCode() public view returns(bytes memory) {
        return abi.encodePacked(hex"3d602d80600a3d3981f3",hex"363d3d373d3d3d363d73",implementation,hex"5af43d82803e903d91602b57fd5bf3");
    }
    function predict(bytes32 salt) public view returns(address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),address(this),salt,keccak256(creationCode()))))));
    }
    function deploy(bytes32 salt) external returns(address validator) {
        validator=predict(salt);
        if(validator.code.length > 0)return validator;
        bytes memory code=creationCode();
        assembly { validator := create2(0,add(code,32),mload(code),salt) }
        require(validator != address(0),"deployment failed");
    }
}
