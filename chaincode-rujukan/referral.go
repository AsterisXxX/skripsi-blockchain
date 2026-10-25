package main

import (
	"encoding/json"
	"fmt"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type SmartContract struct {
	contractapi.Contract
}

type ReferralRecord struct {
	ReferralID         string `json:"referralId"`
	PatientID          string `json:"patientId"`
	SenderHospitalID   string `json:"senderHospitalId"`
	ReceiverHospitalID string `json:"receiverHospitalId"`
	RecordHash         string `json:"recordHash"`
	Timestamp          string `json:"timestamp"`
	Status             string `json:"status"`
}

func (s *SmartContract) CreateReferral(ctx contractapi.TransactionContextInterface, id string, patientID string, receiverID string, hash string, time string) error {
	clientMSPID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("gagal mendapatkan identitas klien: %v", err)
	}

	if clientMSPID != "Org1MSP" && clientMSPID != "Org2MSP" {
		return fmt.Errorf("akses ditolak: otorisasi tidak valid")
	}

	referral := ReferralRecord{
		ReferralID:         id,
		PatientID:          patientID,
		SenderHospitalID:   clientMSPID,
		ReceiverHospitalID: receiverID,
		RecordHash:         hash,
		Timestamp:          time,
		Status:             "Aktif",
	}

	referralJSON, err := json.Marshal(referral)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(id, referralJSON)
}

func (s *SmartContract) GetReferral(ctx contractapi.TransactionContextInterface, id string) (*ReferralRecord, error) {
	referralJSON, err := ctx.GetStub().GetState(id)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca dari world state: %v", err)
	}
	if referralJSON == nil {
		return nil, fmt.Errorf("rujukan dengan ID %s tidak ditemukan", id)
	}

	var referral ReferralRecord
	err = json.Unmarshal(referralJSON, &referral)
	if err != nil {
		return nil, err
	}

	return &referral, nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(new(SmartContract))
	if err != nil {
		fmt.Printf("Error create chaincode: %s", err.Error())
		return
	}
	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting chaincode: %s", err.Error())
	}
}