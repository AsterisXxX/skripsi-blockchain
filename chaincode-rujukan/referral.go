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

func (s *SmartContract) CreateReferral(
	ctx contractapi.TransactionContextInterface,
	id string,
	patientID string,
	receiverID string,
	hash string,
	time string,
) error {

	// 1. Ambil identitas organisasi pengirim transaksi
	clientMSPID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("gagal mendapatkan MSP ID: %v", err)
	}

	// 2. Hanya Org1 yang boleh membuat rujukan
	if clientMSPID != "Org1MSP" {
		return fmt.Errorf("akses ditolak: hanya Org1MSP boleh membuat rujukan")
	}

	// 3. Validasi input
	if id == "" || patientID == "" || receiverID != "Org2MSP" || time == "" {
		return fmt.Errorf("metadata rujukan tidak valid")
	}

	// 4. Validasi format hash SHA-256
	if len(hash) != 64 {
		return fmt.Errorf("hash SHA-256 harus 64 karakter hexadecimal")
	}

	for _, c := range hash {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return fmt.Errorf("format hash harus hexadecimal lowercase")
		}
	}

	// 5. Cek apakah ID sudah ada di ledger
	existing, err := ctx.GetStub().GetState(id)
	if err != nil {
		return fmt.Errorf("gagal memeriksa ID rujukan: %v", err)
	}

	if existing != nil {
		return fmt.Errorf("rujukan dengan ID %s sudah terdaftar", id)
	}

	// 6. Bentuk metadata yang disimpan di blockchain
	referral := ReferralRecord{
		ReferralID:         id,
		PatientID:          patientID,
		SenderHospitalID:   clientMSPID,
		ReceiverHospitalID: receiverID,
		RecordHash:         hash,
		Timestamp:          time,
		Status:             "Aktif",
	}

	// 7. Ubah metadata ke JSON
	referralJSON, err := json.Marshal(referral)
	if err != nil {
		return fmt.Errorf("gagal membuat JSON: %v", err)
	}

	// 8. Simpan metadata ke world state
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
